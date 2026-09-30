import { chromium } from 'playwright'
import { PublicError, resolveAddress, validateUrl } from './remote.mjs'

// The browser is used only for a fixed public Douyin post URL, never as a
// general-purpose URL proxy. Each request uses a new context with no user data.
const PLATFORM_DOMAINS = [
  'douyin.com',
  'douyinstatic.com',
  'douyinpic.com',
  'byteimg.com',
  'bytecdn.com',
  'bytescm.com',
  'bytetos.com',
  'bytegoofy.com',
  'bytedance.com',
  'zijieapi.com',
  'yhgfb-cn-static.com',
  'bytefcdnrd.com',
  'pstatp.com',
  'amemv.com',
  'snssdk.com',
]
export function allowedBrowserUrl(input, navigation = false) {
  try {
    const url = validateUrl(input)
    if (url.protocol !== 'https:') return false
    if (navigation)
      return (
        url.hostname === 'www.douyin.com' &&
        /^\/(?:note\/\d+|video\/\d+|discover|jingxuan|)$/.test(url.pathname)
      )
    return PLATFORM_DOMAINS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain),
    )
  } catch {
    return false
  }
}

async function launchBrowser() {
  for (const channel of ['chrome', undefined, 'msedge']) {
    try {
      return await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
        timeout: 10000,
      })
    } catch {
      /* Try an installed browser or bundled Chromium. */
    }
  }
  throw new PublicError(
    '抖音分享需要浏览器读取，但服务器尚未安装浏览器。请在服务器运行 npx playwright install chromium 后重试。',
    503,
  )
}

export async function readDouyinPage(id, { signal, parse }) {
  if (!/^\d{10,25}$/.test(id)) throw new PublicError('没有识别到有效的抖音作品编号。', 400)
  signal?.throwIfAborted()
  const browser = await launchBrowser()
  const deadline = AbortSignal.any([AbortSignal.timeout(26000), ...(signal ? [signal] : [])])
  let context
  const close = () => {
    void browser.close().catch(() => {})
  }
  deadline.addEventListener('abort', close, { once: true })
  try {
    deadline.throwIfAborted()
    context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1366, height: 900 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    })
    const verified = new Map()
    await context.routeWebSocket('**/*', (socket) => socket.close())
    await context.route('**/*', async (route) => {
      const request = route.request()
      const isDocument = request.isNavigationRequest()
      if (
        !allowedBrowserUrl(request.url(), isDocument) ||
        ['image', 'media', 'font'].includes(request.resourceType())
      )
        return route.abort().catch(() => {})
      try {
        const host = new URL(request.url()).hostname
        if (!verified.has(host)) verified.set(host, resolveAddress(host))
        await verified.get(host)
        if (deadline.aborted) return route.abort().catch(() => {})
        await route.continue()
      } catch {
        await route.abort().catch(() => {})
      }
    })
    const page = await context.newPage()
    let complete
    const result = new Promise((resolve) => {
      complete = resolve
    })
    page.on('response', async (response) => {
      if (
        !response.request().isNavigationRequest() ||
        response.frame() !== page.mainFrame() ||
        !allowedBrowserUrl(response.url(), true)
      )
        return
      if (Number(response.headers()['content-length'] || 0) > 5 * 1024 * 1024) return
      try {
        const html = await response.text()
        if (html.length > 5 * 1024 * 1024) return
        const parsed = parse(html, response.url())
        if (parsed) complete(parsed)
      } catch {
        /* Navigation can replace an intermediate browser document. */
      }
    })
    await page
      .goto(`https://www.douyin.com/note/${id}`, { waitUntil: 'domcontentloaded', timeout: 22000 })
      .catch(() => {})
    // The first response may be the visitor bootstrap. Wait for the ordinary
    // page navigation to finish and expose the requested post's streamed data.
    const cancelled = new Promise((resolve) => {
      if (deadline.aborted) resolve(null)
      else deadline.addEventListener('abort', () => resolve(null), { once: true })
    })
    const parsed = await Promise.race([result, cancelled])
    signal?.throwIfAborted()
    return parsed
  } finally {
    deadline.removeEventListener('abort', close)
    await context?.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}
