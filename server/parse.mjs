import { load } from 'cheerio'
import { extractShareUrl, fetchRemote, PublicError, sniffMedia } from './remote.mjs'
import { readDouyinPage } from './douyin-browser.mjs'

const absolute = (value, base) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('$')) return null
  try {
    const url = new URL(value, base)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
const firstUrl = (value, base) => {
  if (typeof value === 'string') return absolute(value, base)
  if (Array.isArray(value)) return value.map((item) => firstUrl(item, base)).find(Boolean)
  if (!value || typeof value !== 'object') return null
  for (const key of [
    'url_list',
    'urlList',
    'UrlList',
    'urlDefault',
    'url',
    'Url',
    'src',
    'masterUrl',
    'contentUrl',
    'downloadUrl',
    'imageURL',
    'display_image',
    'origin_image',
  ]) {
    const found = firstUrl(value[key], base)
    if (found) return found
  }
  return null
}

// Read hydration JSON as data. Never execute JavaScript supplied by a page.
export function assignedJson(text, marker) {
  const at = text.search(marker)
  if (at < 0) return null
  const start = text.indexOf('{', at)
  if (start < 0) return null
  let depth = 0,
    quoted = false,
    escaped = false,
    out = ''
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    if ('{['.includes(char)) depth++
    if ('}]'.includes(char)) depth--
    if (
      text.slice(i, i + 9) === 'undefined' &&
      !/[\w$]/.test(text[i - 1] || '') &&
      !/[\w$]/.test(text[i + 9] || '')
    ) {
      out += 'null'
      i += 8
    } else out += char
    if (!depth) {
      try {
        return JSON.parse(out)
      } catch {
        return null
      }
    }
  }
  return null
}

function findPost(root, targetId) {
  const queue = [root]
  for (let count = 0; queue.length && count < 8000; count++) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    const id = String(node.aweme_id ?? node.awemeId ?? node.noteId ?? node.id ?? '')
    const hasMedia =
      node.video || node.images || node.imageList || node.image_post_info || node.imagePost
    if (
      hasMedia &&
      (!targetId || id === targetId) &&
      (id || node.desc || node.title || node.noteType || node.type)
    )
      return node
    for (const [key, value] of Object.entries(node)) {
      if (/recommend|related|suggest|user|author|comment/i.test(key)) continue
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return null
}

function mediaFromPost(post, base, fallbackTitle) {
  if (!post) return null
  if (post.isPrivate === true || post.isFriendLimit === true) return null
  const title = String(
    post.title || post.desc || post.description || post.itemTitle || fallbackTitle || '提取的图片',
  ).slice(0, 250)
  const author =
    post.author?.nickname ||
    post.authorInfo?.nickname ||
    post.author?.uniqueId ||
    post.user?.nickname ||
    ''
  const gallery =
    post.images ||
    post.image_post_info?.images ||
    post.image_post_info?.image_list ||
    post.imagePost?.images ||
    (post.type !== 'video' ? post.imageList : null)
  if (Array.isArray(gallery) && gallery.length) {
    const images = [...new Set(gallery.map((item) => firstUrl(item, base)).filter(Boolean))].slice(
      0,
      60,
    )
    if (images.length) return { kind: 'gallery', title, author, images }
  }
  const video = post.video
  if (video) {
    let url = firstUrl(
      video.play_addr_h264 ||
        video.play_addr ||
        video.playAddr ||
        video.download_addr ||
        video.downloadAddr,
      base,
    )
    if (!url) {
      const streams = video.media?.stream || {}
      const variants = [...(streams.h264 || []), ...Object.values(streams).flat()].filter(
        (item) => item && typeof item === 'object',
      )
      variants.sort((a, b) => (b.width || 0) - (a.width || 0))
      url = variants.map((item) => firstUrl(item.masterUrl || item.backupUrls, base)).find(Boolean)
    }
    if (url) return { kind: 'video', title, author, video: url }
  }
  return null
}

// React's streamed payload consists of JSON string chunks. Decode literals only;
// do not execute scripts or evaluate JavaScript supplied by the platform.
export function streamedPageData(html) {
  const chunks = []
  const pattern = /(?:self|window)\.__pace_f\.push\(\s*\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)/g
  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1]))
    } catch {
      /* Incomplete chunk. */
    }
  }
  const roots = []
  const read = (text) => {
    try {
      if (text.startsWith('%7B') || text.startsWith('%5B'))
        roots.push(JSON.parse(decodeURIComponent(text)))
      else if (text.startsWith('{') || text.startsWith('[')) roots.push(JSON.parse(text))
    } catch {
      /* Module references and non-JSON records contain no post data. */
    }
  }
  for (const chunk of chunks) read(chunk.trim())
  for (const record of chunks.join('').split('\n')) {
    const match = record.match(/^[a-f\d]+:([\[{].*)$/i)
    if (match) read(match[1])
  }
  return roots
}

export function parsePage(html, base, { expectedPostId, requirePost = false } = {}) {
  const $ = load(html)
  const fallbackTitle =
    $('meta[property="og:title"]').attr('content') || $('title').text().trim() || '提取的图片'
  const url = new URL(base)
  const targetId =
    expectedPostId ||
    url.pathname.match(/\/(?:video|note|slides|explore|item)\/([\da-f]+)/i)?.[1] ||
    url.searchParams.get('modal_id') ||
    url.searchParams.get('aweme_id')
  const roots = []
  for (const marker of [
    /window\._ROUTER_DATA\s*=/,
    /window\._SSR_DATA\s*=/,
    /window\.__INITIAL_STATE__\s*=/,
    /window\.__INIT_PROPS__\s*=/,
  ]) {
    const root = assignedJson(html, marker)
    if (root) roots.push(root)
  }
  $(
    'script[id="RENDER_DATA"],script[id="__NEXT_DATA__"],script[id="SIGI_STATE"],script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]',
  ).each((_i, element) => {
    const content = $(element).text()
    try {
      roots.push(JSON.parse(content))
    } catch {
      try {
        roots.push(JSON.parse(decodeURIComponent(content)))
      } catch {
        /* Unsupported hydration shape. */
      }
    }
  })
  roots.push(...streamedPageData(html))
  for (const root of roots) {
    const result = mediaFromPost(findPost(root, targetId), base, fallbackTitle)
    if (result) return result
  }
  if (requirePost) return null
  let structured
  $('script[type="application/ld+json"]').each((_i, element) => {
    try {
      const root = JSON.parse($(element).text())
      const nodes = Array.isArray(root) ? root : [root, ...(root['@graph'] || [])]
      for (const node of nodes) {
        if (node['@type'] === 'VideoObject' && absolute(node.contentUrl, base))
          structured = {
            kind: 'video',
            title: node.name || fallbackTitle,
            video: absolute(node.contentUrl, base),
          }
        if (['ImageGallery', 'ImageObject'].includes(node['@type'])) {
          const images = (Array.isArray(node.image) ? node.image : [node.contentUrl || node.image])
            .map((item) => firstUrl(item, base))
            .filter(Boolean)
          if (images.length)
            structured = {
              kind: 'gallery',
              title: node.name || fallbackTitle,
              images: [...new Set(images)].slice(0, 60),
            }
        }
      }
    } catch {
      /* Other script types are not media data. */
    }
  })
  if (structured) return structured
  const video = absolute(
    $('meta[property="og:video:secure_url"]').attr('content') ||
      $('meta[property="og:video:url"]').attr('content') ||
      $('meta[property="og:video"]').attr('content') ||
      $('video source').attr('src') ||
      $('video').attr('src'),
    base,
  )
  if (video && !/\.m3u8(?:[?#]|$)/i.test(video))
    return { kind: 'video', title: fallbackTitle, video }
  return null
}

export function douyinItem(input) {
  const url = new URL(input)
  if (!/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(url.hostname)) return null
  const id =
    url.pathname.match(/\/(?:video|note|slides)\/(\d{10,25})(?:\/|$)/)?.[1] ||
    url.searchParams.get('modal_id') ||
    url.searchParams.get('aweme_id')
  return /^\d{10,25}$/.test(id || '') ? id : null
}

async function resolveDouyin(id, source, { signal, fetcher, browserReader }) {
  // A share path containing /video/ can still refer to an image album.
  // The public slides endpoint and the desktop page both support those posts.
  const urls = [
    `https://www.iesdouyin.com/web/api/v2/aweme/slidesinfo/?aweme_ids=%5B${id}%5D&request_source=200`,
    `https://www.iesdouyin.com/web/api/v2/aweme/slidesinfo/?aweme_ids=%5B${id}%5D`,
  ]
  for (const url of urls) {
    signal?.throwIfAborted()
    try {
      const response = await fetcher(url, { signal, limit: 5 * 1024 * 1024, referer: source })
      const data = JSON.parse(response.buffer.toString('utf8'))
      const post = Array.isArray(data.aweme_details)
        ? data.aweme_details.find((post) => String(post.aweme_id ?? post.awemeId) === id)
        : null
      const parsed = mediaFromPost(post, source, '抖音分享')
      if (parsed) return { ...parsed, source }
    } catch {
      signal?.throwIfAborted()
      // Endpoint failures are not proof of a private post. Continue with the
      // same public post in a fresh, anonymous browser context.
    }
  }
  signal?.throwIfAborted()
  const parsed = await browserReader(id, {
    signal,
    parse: (html, url) => parsePage(html, url, { expectedPostId: id, requirePost: true }),
  })
  if (parsed) return { ...parsed, source }
  throw new PublicError(
    '已识别这条抖音分享，但暂未读取到对应作品的图片。请稍后重试；此错误不表示作品一定需要登录。',
  )
}

export async function resolveShare(
  text,
  { signal, fetcher = fetchRemote, browserReader = readDouyinPage } = {},
) {
  const requested = extractShareUrl(text)
  let first
  try {
    first = await fetcher(requested, { signal })
  } catch (error) {
    signal?.throwIfAborted()
    const id = douyinItem(requested)
    if (!id) throw error
    return resolveDouyin(id, requested.href, { signal, fetcher, browserReader })
  }
  const mediaType = sniffMedia(first.buffer)
  if (mediaType?.startsWith('image/') && first.buffer.length > 16 * 1024 * 1024)
    throw new PublicError('单张图片超过了 16 MB，请选择小一些的图片。')
  if (mediaType)
    return {
      kind: mediaType.startsWith('video/') ? 'video' : 'gallery',
      title: new URL(first.url).pathname.split('/').pop()?.slice(0, 180) || '分享内容',
      source: first.url,
      direct: first,
      mediaType,
    }
  const parsed = parsePage(first.buffer.toString('utf8'), first.url)
  const id = douyinItem(first.url)
  if (!parsed && id) return resolveDouyin(id, first.url, { signal, fetcher, browserReader })
  if (!parsed)
    throw new PublicError(
      '没有读到可提取的图片或视频。该链接可能需要登录、验证或已失效；请换一条公开分享链接，或使用本地视频。',
    )
  return { ...parsed, source: first.url }
}
