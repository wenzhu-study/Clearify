import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'

export class PublicError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.status = status
  }
}

export function extractShareUrl(text) {
  if (typeof text !== 'string' || text.length > 12000)
    throw new PublicError('分享内容太长，请只粘贴一条视频分享链接。', 400)
  const matched = text
    .match(/https?:\/\/[^\s<>"'\u3000]+/i)?.[0]
    ?.replace(/[，。；！、）】》”’),;!]+$/, '')
  if (!matched)
    throw new PublicError('没有找到链接，请粘贴包含 http 或 https 地址的完整分享内容。', 400)
  return validateUrl(matched)
}

export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

export function validateUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new PublicError('这个链接格式不完整，请重新复制分享链接。', 400)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new PublicError('只支持公开的 HTTP / HTTPS 网页或视频链接。', 400)
  if (
    (!host.includes('.') && !ipaddr.isValid(host)) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  )
    throw new PublicError('请使用公开的分享链接，不支持本机或内网地址。', 400)
  url.hash = ''
  return url
}

export async function resolveAddress(hostname, resolver = lookup) {
  const host = hostname.replace(/^\[|\]$/g, '')
  const entries = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv6' ? 6 : 4 }]
    : await resolver(host, { all: true, verbatim: true })
  if (!entries.length || entries.some((entry) => !isPublicAddress(entry.address)))
    throw new PublicError('该链接指向非公开地址，无法读取。', 400)
  return entries.find((entry) => entry.family === 4) || entries[0]
}

export const MOBILE_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'

export function sniffMedia(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (/^GIF8[79]a/.test(buffer.toString('ascii', 0, 6))) return 'image/gif'
  if (buffer.toString('ascii', 4, 8) === 'ftyp')
    return /avif|avis/.test(buffer.toString('ascii', 8, 32)) ? 'image/avif' : 'video/mp4'
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  return null
}

export async function fetchRemote(
  input,
  { signal, limit = 100 * 1024 * 1024, referer, redirects = 0 } = {},
) {
  const url = validateUrl(input)
  if (redirects > 5) throw new PublicError('链接跳转次数过多，请尝试粘贴最终页面的地址。')
  const abort = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])])
  const address = await resolveAddress(url.hostname)
  abort.throwIfAborted()
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        signal: abort,
        headers: {
          'User-Agent': MOBILE_AGENT,
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          ...(referer ? { Referer: new URL(referer).origin + '/' } : {}),
        },
        lookup: (_host, options, callback) =>
          options?.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      resolve,
    )
    request.on('error', reject)
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers.location
    response.destroy()
    if (!location) throw new PublicError('这个分享链接无法正常跳转，请重新复制。')
    return fetchRemote(new URL(location, url), {
      signal: abort,
      limit,
      referer,
      redirects: redirects + 1,
    })
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy()
    throw new PublicError(
      [401, 403, 429].includes(response.statusCode)
        ? '来源网站暂时拒绝了读取请求，请稍后重试。'
        : '分享内容暂时无法读取，可能已失效或被删除。',
    )
  }
  const type = String(response.headers['content-type'] || '').toLowerCase()
  const maxBytes = /text|json|xml|javascript/.test(type) ? Math.min(limit, 5 * 1024 * 1024) : limit
  if (Number(response.headers['content-length'] || 0) > maxBytes) {
    response.destroy()
    throw new PublicError('文件过大，在线解析支持 100 MB 以内的视频或 16 MB 以内的单张图片。')
  }
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of response) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new PublicError('内容超过了读取上限，请尝试更小的视频或图片。')
      chunks.push(chunk)
    }
  } finally {
    response.destroy()
  }
  return { buffer: Buffer.concat(chunks), type, url: url.href }
}
