/// <reference lib="webworker" />
import { outputSize } from './types'
import type { EnhanceOptions } from './types'

const scope = self as unknown as DedicatedWorkerGlobalScope

function report(progress: number, message: string) {
  scope.postMessage({ type: 'progress', progress, message })
}

function lanczos(x: number) {
  if (Math.abs(x) < 0.00001) return 1
  if (Math.abs(x) >= 3) return 0
  const p = Math.PI * x
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p)
}

function filterWeights(input: number, output: number) {
  const indices = new Int32Array(output * 6)
  const weights = new Float32Array(output * 6)
  for (let x = 0; x < output; x++) {
    const center = ((x + 0.5) * input) / output - 0.5
    const start = Math.floor(center) - 2
    let total = 0
    for (let tap = 0; tap < 6; tap++) {
      const index = x * 6 + tap
      indices[index] = Math.max(0, Math.min(input - 1, start + tap))
      weights[index] = lanczos(center - start - tap)
      total += weights[index]
    }
    for (let tap = 0; tap < 6; tap++) weights[x * 6 + tap] /= total
  }
  return { indices, weights }
}

function removeNoise(pixels: Uint8ClampedArray, width: number, height: number) {
  const result = new Uint8ClampedArray(pixels)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pos = (y * width + x) * 4
      if (pixels[pos + 3] < 250) continue
      let red = pixels[pos] * 4,
        green = pixels[pos + 1] * 4,
        blue = pixels[pos + 2] * 4,
        count = 4
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nearby = ((y + dy) * width + x + dx) * 4
          const difference =
            Math.abs(pixels[pos] - pixels[nearby]) +
            Math.abs(pixels[pos + 1] - pixels[nearby + 1]) +
            Math.abs(pixels[pos + 2] - pixels[nearby + 2])
          if (difference < 28 && pixels[nearby + 3] > 250) {
            red += pixels[nearby]
            green += pixels[nearby + 1]
            blue += pixels[nearby + 2]
            count++
          }
        }
      }
      result[pos] = red / count
      result[pos + 1] = green / count
      result[pos + 2] = blue / count
    }
  }
  return result
}

function resize(input: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number) {
  const horizontal = filterWeights(sw, dw)
  const vertical = filterWeights(sh, dh)
  const intermediate = new Float32Array(dw * sh * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const target = (y * dw + x) * 4
      for (let tap = 0; tap < 6; tap++) {
        const weightIndex = x * 6 + tap
        const src = (y * sw + horizontal.indices[weightIndex]) * 4
        const weight = horizontal.weights[weightIndex]
        const alpha = input[src + 3] / 255
        intermediate[target] += input[src] * alpha * weight
        intermediate[target + 1] += input[src + 1] * alpha * weight
        intermediate[target + 2] += input[src + 2] * alpha * weight
        intermediate[target + 3] += input[src + 3] * weight
      }
    }
    if (y % 128 === 0) report(15 + Math.round((y / sh) * 28), '正在重建画面像素…')
  }
  const output = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0
      for (let tap = 0; tap < 6; tap++) {
        const weightIndex = y * 6 + tap
        const src = (vertical.indices[weightIndex] * dw + x) * 4
        const weight = vertical.weights[weightIndex]
        red += intermediate[src] * weight
        green += intermediate[src + 1] * weight
        blue += intermediate[src + 2] * weight
        alpha += intermediate[src + 3] * weight
      }
      const target = (y * dw + x) * 4
      const multiplier = alpha > 0.01 ? 255 / alpha : 0
      output[target] = red * multiplier
      output[target + 1] = green * multiplier
      output[target + 2] = blue * multiplier
      output[target + 3] = alpha
    }
    if (y % 128 === 0) report(43 + Math.round((y / dh) * 32), '正在还原清晰边缘…')
  }
  return output
}

function sharpen(data: Uint8ClampedArray, width: number, height: number, amount: number) {
  const stride = width * 4
  let previous = data.slice(0, stride)
  let current = data.slice(0, stride)
  let next = data.slice(stride, stride * 2)
  for (let y = 1; y < height - 1; y++) {
    const spare = previous
    previous = current
    current = next
    next = spare
    next.set(data.subarray((y + 1) * stride, (y + 2) * stride))
    for (let x = 1; x < width - 1; x++) {
      const pos = x * 4
      if (current[pos + 3] < 250) continue
      for (let c = 0; c < 3; c++) {
        const i = pos + c
        const blur =
          (previous[i - 4] +
            previous[i] * 2 +
            previous[i + 4] +
            current[i - 4] * 2 +
            current[i] * 4 +
            current[i + 4] * 2 +
            next[i - 4] +
            next[i] * 2 +
            next[i + 4]) /
          16
        const detail = current[i] - blur
        data[y * stride + i] =
          current[i] + (Math.abs(detail) > 1 ? Math.max(-24, Math.min(24, detail * amount)) : 0)
      }
    }
    if (y % 256 === 0) report(76 + Math.round((y / height) * 15), '正在增强细腻质感…')
  }
}

scope.onmessage = async (event: MessageEvent<{ file: Blob; options: EnhanceOptions }>) => {
  let bitmap: ImageBitmap | null = null
  try {
    const { file, options } = event.data
    report(3, '正在读取图片…')
    bitmap = await createImageBitmap(file)
    const sw = bitmap.width,
      sh = bitmap.height
    if (sw * sh > 24_000_000 || Math.max(sw, sh) > 8000)
      throw new Error('图片尺寸过大，请选择 2400 万像素、长边 8000px 以内的图片。')
    const size = outputSize(sw, sh, options.scale)
    const canvas = new OffscreenCanvas(sw, sh)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器暂不支持图片处理，请使用新版 Chrome、Edge 或 Safari。')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    bitmap = null
    const source = context.getImageData(0, 0, sw, sh)
    canvas.width = 1
    canvas.height = 1
    report(8, options.denoise ? '正在轻柔去除噪点…' : '正在分析画面细节…')
    const clean = options.denoise ? removeNoise(source.data, sw, sh) : source.data
    const data = resize(clean, sw, sh, size.width, size.height)
    sharpen(data, size.width, size.height, options.mode === 'detail' ? 1.8 : 0.85)
    report(93, '正在生成高清文件…')
    const result = new OffscreenCanvas(size.width, size.height)
    const resultContext = result.getContext('2d')!
    resultContext.putImageData(new ImageData(data, size.width, size.height), 0, 0)
    if (options.format === 'image/jpeg') {
      resultContext.globalCompositeOperation = 'destination-over'
      resultContext.fillStyle = '#ffffff'
      resultContext.fillRect(0, 0, size.width, size.height)
    }
    const blob = await result.convertToBlob({ type: options.format, quality: 0.96 })
    const ratio = Math.min(1, 500 / Math.max(size.width, size.height))
    const thumbnailCanvas = new OffscreenCanvas(
      Math.max(1, Math.round(size.width * ratio)),
      Math.max(1, Math.round(size.height * ratio)),
    )
    thumbnailCanvas
      .getContext('2d')!
      .drawImage(result, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height)
    const thumbnail = await thumbnailCanvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
    scope.postMessage({
      type: 'done',
      blob,
      thumbnail,
      width: size.width,
      height: size.height,
      format: blob.type,
    })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '图片处理失败，请换一张图片再试。',
    })
  } finally {
    bitmap?.close()
  }
}
