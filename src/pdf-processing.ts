import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type PdfMode = 'auto' | 'all'
export type PdfQuality = 216 | 288
export interface PdfPageInfo {
  number: number
  width: number
  height: number
  vector: boolean
  original: Blob
  enhanced?: Blob
  processed?: boolean
}
export interface PdfInspection {
  pages: PdfPageInfo[]
  hasForms: boolean
}

const canceled = (signal: AbortSignal) => signal.throwIfAborted()

function pdfError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/password/i.test(message)) return new Error('这个 PDF 设置了密码，请先解除密码后再上传。')
  if (/invalid|missing|format|corrupt|header/i.test(message))
    return new Error('无法读取这个 PDF。请检查文件是否完整。')
  return error instanceof Error ? error : new Error('PDF 处理失败，请重新尝试。')
}

async function openPdf(file: File) {
  // pdf.js transfers its copy to the worker. Keep the File intact for pdf-lib.
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    cMapUrl: '/pdf/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf/standard_fonts/',
    wasmUrl: '/pdf/wasm/',
  })
  try {
    const pdf = await task.promise
    if (pdf.numPages < 1 || pdf.numPages > 30)
      throw new Error('目前支持 1 到 30 页的 PDF，请拆分较长的文档后再处理。')
    if ((await pdf.getSignatures())?.length)
      throw new Error('已签名的 PDF 不能重新生成，否则签名会失效。请使用未签名的副本。')
    const hasForms = Boolean(await pdf.getFieldObjects())
    if (hasForms)
      throw new Error('暂不支持含交互表单的 PDF，以免处理后丢失填写内容。请先导出不含表单的副本。')
    return { task, pdf, hasForms }
  } catch (error) {
    await task.destroy().catch(() => {})
    throw pdfError(error)
  }
}

async function renderPage(page: PDFPageProxy, scale: number, signal: AbortSignal) {
  canceled(signal)
  const viewport = page.getViewport({ scale })
  const width = Math.max(1, Math.ceil(viewport.width))
  const height = Math.max(1, Math.ceil(viewport.height))
  if (width * height > 19_000_000 || width > 5200 || height > 5200)
    throw new Error('这一页的尺寸过大。请选择较低的输出清晰度。')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const rendering = page.render({ canvas, viewport, background: 'rgb(255,255,255)' })
  const abort = () => rendering.cancel()
  signal.addEventListener('abort', abort, { once: true })
  try {
    await rendering.promise
    canceled(signal)
    return canvas
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function asBlob(canvas: HTMLCanvasElement, type: 'image/jpeg', quality = 0.94) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('页面图片生成失败。'))),
      type,
      quality,
    )
  })
}

export async function inspectPdf(
  file: File,
  signal: AbortSignal,
  progress: (page: number, total: number) => void,
): Promise<PdfInspection> {
  if (file.size > 35 * 1024 * 1024) throw new Error('PDF 超过 35 MB，请压缩或拆分后再上传。')
  const { task, pdf, hasForms } = await openPdf(file)
  const pages: PdfPageInfo[] = []
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      canceled(signal)
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const operators = await page.getOperatorList()
      const glyphs = operators.fnArray.filter(
        (op) => op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText,
      ).length
      const originalCanvas = await renderPage(
        page,
        Math.min(1.25, 900 / Math.max(viewport.width, viewport.height)),
        signal,
      )
      pages.push({
        number: i,
        width: viewport.width,
        height: viewport.height,
        vector: glyphs > 0,
        original: await asBlob(originalCanvas, 'image/jpeg', 0.88),
      })
      originalCanvas.width = 0
      originalCanvas.height = 0
      page.cleanup()
      progress(i, pdf.numPages)
    }
    return { pages, hasForms }
  } catch (error) {
    throw pdfError(error)
  } finally {
    await task.destroy().catch(() => {})
  }
}

async function sharpenDocument(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  // Three cached rows keep the filter memory bounded on high-resolution A4 pages.
  const stride = width * 4
  let previous = data.slice(0, stride)
  let current = data.slice(0, stride)
  let next = data.slice(stride, stride * 2)
  for (let y = 1; y < height - 1; y++) {
    if (y % 96 === 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      canceled(signal)
    }
    const reuse = previous
    previous = current
    current = next
    next = reuse
    next.set(data.subarray((y + 1) * stride, (y + 2) * stride))
    for (let x = 1; x < width - 1; x++) {
      const pos = x * 4
      for (let channel = 0; channel < 3; channel++) {
        const center = current[pos + channel]
        const mean =
          (current[pos - 4 + channel] +
            current[pos + 4 + channel] +
            previous[pos + channel] +
            next[pos + channel]) /
          4
        const detail = center - mean
        let value = center + Math.max(-26, Math.min(26, detail * 0.85))
        if (value > 233) value += (255 - value) * 0.3
        data[y * stride + pos + channel] = value
      }
    }
  }
  ctx.putImageData(image, 0, 0)
}

export async function enhancePdf(
  file: File,
  inspected: PdfInspection,
  options: { mode: PdfMode; quality: PdfQuality },
  signal: AbortSignal,
  progress: (page: number, total: number) => void,
) {
  const { task, pdf } = await openPdf(file)
  try {
    if (inspected.hasForms && options.mode === 'all')
      throw new Error(
        '含有交互表单的 PDF 不支持「全部增强」，请选择「智能保留」以避免丢失表单内容。',
      )
    const source = await PDFDocument.load(await file.arrayBuffer())
    const output = await PDFDocument.create()
    output.setTitle(`${source.getTitle() || file.name.replace(/\.pdf$/i, '')} - Clearify`)
    const pages: PdfPageInfo[] = []
    for (let i = 0; i < pdf.numPages; i++) {
      canceled(signal)
      const pageInfo = inspected.pages[i]
      const keep = options.mode === 'auto' && (pageInfo.vector || inspected.hasForms)
      if (keep) {
        const [copied] = await output.copyPages(source, [i])
        output.addPage(copied)
        pages.push({ ...pageInfo, processed: false })
      } else {
        const pdfPage = await pdf.getPage(i + 1)
        const scale = Math.min(
          options.quality / 72,
          Math.sqrt(18_000_000 / (pageInfo.width * pageInfo.height)),
          5200 / Math.max(pageInfo.width, pageInfo.height),
        )
        const canvas = await renderPage(pdfPage, scale, signal)
        canceled(signal)
        await sharpenDocument(canvas, signal)
        const image = await asBlob(canvas, 'image/jpeg', 0.96)
        const embedded = await output.embedJpg(await image.arrayBuffer())
        const newPage = output.addPage([pageInfo.width, pageInfo.height])
        newPage.drawImage(embedded, { x: 0, y: 0, width: pageInfo.width, height: pageInfo.height })
        const previewScale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height))
        const preview = document.createElement('canvas')
        preview.width = Math.max(1, Math.round(canvas.width * previewScale))
        preview.height = Math.max(1, Math.round(canvas.height * previewScale))
        preview.getContext('2d')!.drawImage(canvas, 0, 0, preview.width, preview.height)
        pages.push({
          ...pageInfo,
          processed: true,
          enhanced: await asBlob(preview, 'image/jpeg', 0.92),
        })
        canvas.width = 0
        canvas.height = 0
        preview.width = 0
        preview.height = 0
        pdfPage.cleanup()
      }
      progress(i + 1, pdf.numPages)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    canceled(signal)
    const bytes = await output.save()
    canceled(signal)
    return { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pages }
  } catch (error) {
    throw pdfError(error)
  } finally {
    await task.destroy().catch(() => {})
  }
}
