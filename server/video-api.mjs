import { randomBytes } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { resolveShare } from './parse.mjs'
import { fetchRemote, PublicError, sniffMedia } from './remote.mjs'

const TTL = 15 * 60 * 1000
const MAX_CACHE = 160 * 1024 * 1024

export function createVideoApi({ resolver = resolveShare, fetcher = fetchRemote } = {}) {
  const assets = new Map()
  let resolving = 0,
    downloading = 0
  function purge() {
    const now = Date.now()
    let bytes = 0
    for (const [id, asset] of assets) {
      if (asset.expires < now) assets.delete(id)
      else bytes += asset.data?.buffer.length || 0
    }
    for (const [id, asset] of assets) {
      if (bytes <= MAX_CACHE && assets.size <= 180) break
      bytes -= asset.data?.buffer.length || 0
      assets.delete(id)
    }
  }
  function register(url, referer, kind, data) {
    purge()
    const id = randomBytes(24).toString('hex')
    assets.set(id, { url, referer, kind, data, expires: Date.now() + TTL })
    purge()
    return `/api/video/assets/${id}`
  }
  const json = (response, status, data) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(JSON.stringify(data))
  }
  return async (
    request,
    response,
    next = () => {
      response.statusCode = 404
      response.end()
    },
  ) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname
    if (!path.startsWith('/api/video/')) return next()
    const controller = new AbortController()
    const onClose = () => {
      if (!response.writableEnded) controller.abort()
    }
    response.on('close', onClose)
    try {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host)
        throw new PublicError('请在当前网站内使用提图功能。', 403)
      if (path === '/api/video/resolve' && request.method === 'POST') {
        if (!String(request.headers['content-type']).startsWith('application/json'))
          throw new PublicError('请求格式不正确。', 415)
        if (resolving >= 3) throw new PublicError('正在处理其他链接，请稍后再试。', 429)
        let body = ''
        let bodyBytes = 0
        const decoder = new StringDecoder('utf8')
        for await (const chunk of request) {
          bodyBytes += chunk.length
          if (bodyBytes > 16000) throw new PublicError('分享内容过长，请只粘贴一条链接。', 413)
          body += decoder.write(chunk)
        }
        body += decoder.end()
        let input
        try {
          input = JSON.parse(body)
        } catch {
          throw new PublicError('请求格式不正确。', 400)
        }
        if (!input || typeof input.text !== 'string')
          throw new PublicError('请粘贴完整的分享链接。', 400)
        if (resolving >= 3) throw new PublicError('正在处理其他链接，请稍后再试。', 429)
        resolving++
        let resolved
        try {
          resolved = await resolver(input.text, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
          })
        } finally {
          resolving--
        }
        const result = {
          kind: resolved.kind,
          title: resolved.title,
          author: resolved.author || '',
          source: resolved.source,
        }
        if (resolved.direct) {
          const asset = register(
            resolved.source,
            resolved.source,
            resolved.kind === 'video' ? 'video' : 'image',
            { buffer: resolved.direct.buffer, type: resolved.mediaType },
          )
          if (resolved.kind === 'video') result.video = asset
          else result.images = [asset]
        } else if (resolved.kind === 'gallery')
          result.images = resolved.images.map((url) => register(url, resolved.source, 'image'))
        else result.video = register(resolved.video, resolved.source, 'video')
        return json(response, 200, result)
      }
      const id = path.match(/^\/api\/video\/assets\/([a-f0-9]{48})$/)?.[1]
      if (id && request.method === 'GET') {
        purge()
        const asset = assets.get(id)
        if (!asset) throw new PublicError('这次解析已过期，请重新提取。', 410)
        if (!asset.data) {
          if (downloading >= 6) throw new PublicError('当前下载较多，请稍后重试。', 429)
          downloading++
          try {
            const data = await fetcher(asset.url, {
              signal: controller.signal,
              referer: asset.referer,
              limit: asset.kind === 'image' ? 16 * 1024 * 1024 : 100 * 1024 * 1024,
            })
            const type = sniffMedia(data.buffer)
            if (!type || !type.startsWith(asset.kind + '/'))
              throw new PublicError('平台返回的不是可读取的媒体文件，可能需要登录或链接已过期。')
            asset.data = { buffer: data.buffer, type }
            purge()
          } finally {
            downloading--
          }
        }
        response.writeHead(200, {
          'Content-Type': asset.data.type,
          'Content-Length': asset.data.buffer.length,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
          'Cross-Origin-Resource-Policy': 'same-origin',
        })
        return response.end(asset.data.buffer)
      }
      return json(response, 404, { error: '接口不存在。' })
    } catch (error) {
      if (response.destroyed || controller.signal.aborted) return
      const message =
        error instanceof PublicError
          ? error.message
          : error.name === 'TimeoutError' || error.name === 'AbortError'
            ? '读取超时，请检查链接后重试。'
            : '暂时无法连接这个链接，请稍后再试，或使用本地视频。'
      if (!response.headersSent) json(response, error.status || 502, { error: message })
      else response.end()
    } finally {
      response.off('close', onClose)
    }
  }
}
