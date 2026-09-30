export type ExtractionMode = 'smart' | 'interval'
export type FrameFormat = 'image/jpeg' | 'image/png'
export interface ExtractedPicture {
  id: string
  blob: Blob
  width: number
  height: number
  time?: number
  order: number
}
export interface ResolvedShare {
  kind: 'gallery' | 'video'
  title: string
  author: string
  source: string
  images?: string[]
  video?: string
}

export function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${String(Math.floor((seconds % 1) * 10))}`
}

export async function responseError(response: Response) {
  try {
    const body = await response.json()
    if (body.error) return new Error(body.error)
  } catch {
    /* Static-only hosting has no JSON API. */
  }
  return new Error('链接解析服务暂不可用，请稍后再试。也可以切换到本地视频。')
}

export async function pictureFromBlob(
  blob: Blob,
  order: number,
  time?: number,
): Promise<ExtractedPicture> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width * bitmap.height > 32_000_000)
      throw new Error('图片尺寸过大，请选择更小的内容。')
    return {
      id: crypto.randomUUID(),
      blob,
      width: bitmap.width,
      height: bitmap.height,
      order,
      time,
    }
  } finally {
    bitmap.close()
  }
}

export async function readGallery(
  urls: string[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
) {
  const results: (ExtractedPicture | undefined)[] = Array(urls.length)
  let cursor = 0,
    done = 0,
    failed = 0,
    totalBytes = 0
  await Promise.all(
    Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (cursor < urls.length) {
        signal.throwIfAborted()
        const index = cursor++
        try {
          const response = await fetch(urls[index], { signal })
          if (!response.ok) throw await responseError(response)
          const blob = await response.blob()
          totalBytes += blob.size
          if (totalBytes > 120 * 1024 * 1024) throw new Error('图片总量过大')
          results[index] = await pictureFromBlob(blob, index + 1)
        } catch (error) {
          if (signal.aborted) throw error
          failed++
        }
        onProgress(++done, urls.length)
      }
    }),
  )
  const pictures = results.filter((item): item is ExtractedPicture => Boolean(item))
  if (!pictures.length)
    throw new Error('图片文件未能下载，平台可能限制了读取或链接已经过期，请重新复制分享链接。')
  return { pictures, failed }
}

function mediaEvent(video: HTMLVideoElement, type: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>
    const clean = () => {
      clearTimeout(timeout)
      video.removeEventListener(type, done)
      video.removeEventListener('error', error)
      signal.removeEventListener('abort', cancel)
    }
    const done = () => {
      clean()
      resolve()
    }
    const error = () => {
      clean()
      reject(new Error('这个视频无法解码，请使用 MP4（H.264）或 WebM 格式的视频。'))
    }
    const cancel = () => {
      clean()
      reject(new DOMException('已取消', 'AbortError'))
    }
    timeout = setTimeout(() => {
      clean()
      reject(new Error('读取视频超时，请换一个视频或重试。'))
    }, 20000)
    video.addEventListener(type, done, { once: true })
    video.addEventListener('error', error, { once: true })
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

export async function extractFrames(
  blob: Blob,
  options: {
    count: number
    mode: ExtractionMode
    format: FrameFormat
    signal: AbortSignal
    onProgress: (progress: number, found: number) => void
  },
) {
  if (blob.size > 100 * 1024 * 1024)
    throw new Error('视频超过 100 MB，请先裁剪或选择小一些的视频。')
  const { signal, onProgress, count, mode, format } = options
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const url = URL.createObjectURL(blob)
  try {
    const loaded = mediaEvent(video, 'loadeddata', signal)
    video.src = url
    video.load()
    await loaded
    signal.throwIfAborted()
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    )
      throw new Error('无法读取视频时长，请使用完整的视频文件。')
    if (video.duration > 1800) throw new Error('目前支持 30 分钟以内的视频，请先裁剪需要的片段。')
    if (
      video.videoWidth * video.videoHeight > 24_000_000 ||
      Math.max(video.videoWidth, video.videoHeight) > 8000
    )
      throw new Error('视频分辨率过大，请选择长边 8000px、2400 万像素以内的视频。')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')!
    const fingerprint = document.createElement('canvas')
    fingerprint.width = 16
    fingerprint.height = 16
    const small = fingerprint.getContext('2d', { willReadFrequently: true })!
    const seen: Uint8ClampedArray[] = []
    const pictures: ExtractedPicture[] = []
    const samples =
      mode === 'smart' ? Math.min(90, Math.max(count, Math.ceil(video.duration * 2))) : count
    let totalBytes = 0
    for (let index = 0; index < samples; index++) {
      signal.throwIfAborted()
      const time = Math.min(
        video.duration - Math.min(0.08, video.duration / 10),
        ((index + 0.35) / samples) * video.duration,
      )
      if (Math.abs(video.currentTime - time) > 0.001) {
        const sought = mediaEvent(video, 'seeked', signal)
        video.currentTime = time
        await sought
      }
      signal.throwIfAborted()
      small.drawImage(video, 0, 0, 16, 16)
      const pixels = small.getImageData(0, 0, 16, 16).data
      const duplicate =
        mode === 'smart' &&
        seen.some((previous) => {
          let difference = 0
          for (let i = 0; i < pixels.length; i++)
            if (i % 4 !== 3) difference += Math.abs(pixels[i] - previous[i])
          return difference / (16 * 16 * 3) < 7
        })
      if (!duplicate && pictures.length < count) {
        context.drawImage(video, 0, 0)
        const image = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error('图片生成失败，请重试。'))),
            format,
            0.96,
          ),
        )
        totalBytes += image.size
        if (totalBytes > 120 * 1024 * 1024)
          throw new Error('提取图片总量超过 120 MB，请减少图片数量或选择 JPG 格式。')
        seen.push(pixels)
        pictures.push({
          id: crypto.randomUUID(),
          blob: image,
          width: canvas.width,
          height: canvas.height,
          time,
          order: pictures.length + 1,
        })
      }
      onProgress(Math.round(((index + 1) / samples) * 100), pictures.length)
      if (pictures.length === count) break
    }
    if (!pictures.length) throw new Error('没有提取到画面，请换一个视频试试。')
    return { pictures, duration: video.duration }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export function pictureName(item: ExtractedPicture) {
  const extension = item.blob.type === 'image/jpeg' ? 'jpg' : item.blob.type.split('/')[1] || 'png'
  return `${item.order}.${extension}`
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export async function downloadPictures(
  items: ExtractedPicture[],
  signal: AbortSignal,
  onProgress: (done: number) => void,
) {
  for (let index = 0; index < items.length; index++) {
    signal.throwIfAborted()
    const item = items[index]
    saveBlob(item.blob, pictureName(item))
    onProgress(index + 1)
    // Space out separate downloads so the browser can handle each file.
    if (index < items.length - 1) {
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer)
          reject(new DOMException('已取消', 'AbortError'))
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }, 300)
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
      })
    }
  }
}
