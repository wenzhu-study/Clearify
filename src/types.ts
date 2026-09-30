export type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp'
export type EnhanceMode = 'natural' | 'detail'

export interface SourceImage {
  file: Blob
  name: string
  url: string
  width: number
  height: number
}

export interface EnhanceOptions {
  scale: 2 | 4
  mode: EnhanceMode
  denoise: boolean
  format: OutputFormat
}

export interface SavedImage {
  id: string
  name: string
  createdAt: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  scale: number
  format: OutputFormat
  blob: Blob
  original: Blob
  thumbnail: Blob
}

export function outputSize(width: number, height: number, scale: number) {
  const factor = Math.min(
    scale,
    8000 / Math.max(width, height),
    Math.sqrt(24_000_000 / (width * height)),
  )
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
    limited: factor < scale,
  }
}

export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function downloadImage(blob: Blob, name: string, format: OutputFormat) {
  const extension = format === 'image/jpeg' ? 'jpg' : format.split('/')[1]
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/\.[^.]+$/, '')}-clearify.${extension}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
