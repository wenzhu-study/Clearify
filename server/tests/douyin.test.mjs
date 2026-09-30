import test from 'node:test'
import assert from 'node:assert/strict'
import { douyinItem, parsePage, resolveShare, streamedPageData } from '../parse.mjs'
import { allowedBrowserUrl } from '../douyin-browser.mjs'

const id = '7615332632016233646'
const source = `https://www.iesdouyin.com/share/video/${id}/`
const post = {
  awemeId: id,
  awemeType: 68,
  desc: '《于是》钢琴谱指法版。',
  authorInfo: { nickname: '谱图作者' },
  video: '$undefined',
  images: [
    { width: 1290, height: 1818, urlList: ['https://p9-pc-sign.douyinpic.com/one.webp?x=1&y=2'] },
    { width: 1290, height: 1804, urlList: ['https://p3-pc-sign.douyinpic.com/two.webp'] },
    { width: 1280, height: 1816, urlList: ['https://p3-pc-sign.douyinpic.com/three.webp'] },
  ],
}
const packet =
  '7:' +
  JSON.stringify(['$', '$L9', null, { awemeId: id, aweme: { statusCode: 0, detail: post } }]) +
  '\n'
const script = (chunk) => `<script>self.__pace_f.push(${JSON.stringify([1, chunk])})</script>`
const streamed = '<title>谱图</title>' + script(packet.slice(0, 170)) + script(packet.slice(170))
const shell = {
  buffer: Buffer.from('<script>window._ROUTER_DATA={"loaderData":{}}</script>'),
  url: source,
  type: 'text/html',
}

test('reads the requested gallery from split desktop streaming records and camelCase fields', () => {
  assert.equal(streamedPageData(streamed).length, 1)
  assert.deepEqual(parsePage(streamed, `https://www.douyin.com/note/${id}`), {
    kind: 'gallery',
    title: '《于是》钢琴谱指法版。',
    author: '谱图作者',
    images: post.images.map((item) => item.urlList[0]),
  })
  const another = streamed.replaceAll(id, '7635876375336879226')
  assert.equal(parsePage(another, `https://www.douyin.com/note/${id}`), null)
  assert.equal(
    parsePage(streamed, 'https://www.douyin.com/jingxuan', {
      expectedPostId: '9999999999999999999',
      requirePost: true,
    }),
    null,
  )
  assert.equal(
    parsePage('<video src="https://example.com/recommendation.mp4"></video>', source, {
      expectedPostId: id,
      requirePost: true,
    }),
    null,
  )
})

test('never executes streamed scripts or treats React sentinels as a video URL', () => {
  globalThis.__clearifyProbe = 0
  const unsafe = '<script>self.__pace_f.push([1,(globalThis.__clearifyProbe=1,"{}")])</script>'
  assert.deepEqual(streamedPageData(unsafe), [])
  assert.equal(globalThis.__clearifyProbe, 0)
  delete globalThis.__clearifyProbe
  const missing = { ...post, images: undefined, video: { playAddr: '$undefined' } }
  assert.equal(parsePage(script('7:' + JSON.stringify(missing) + '\n'), source), null)
  assert.equal(
    parsePage(script('7:' + JSON.stringify({ ...post, isPrivate: true }) + '\n'), source),
    null,
  )
})

test('continues to an anonymous browser when a share shell and image endpoints return no data', async () => {
  const calls = []
  let browserCalls = 0
  const result = await resolveShare('分享 https://v.douyin.com/qcJWKQ6PhcM/', {
    fetcher: async (url) => {
      calls.push(String(url))
      if (new URL(url).hostname === 'v.douyin.com') return shell
      return {
        buffer: Buffer.from(
          JSON.stringify({
            aweme_details: null,
            filter_list: [{ aweme_id: id, reason: 8 }],
            status_code: 0,
          }),
        ),
        url: String(url),
        type: 'application/json',
      }
    },
    browserReader: async (item, { parse }) => {
      assert.equal(item, id)
      browserCalls++
      return parse(streamed, `https://www.douyin.com/note/${id}`)
    },
  })
  assert.equal(result.images.length, 3)
  assert.equal(result.title, '《于是》钢琴谱指法版。')
  assert.equal(browserCalls, 1)
  assert.equal(calls.length, 3)
  assert(calls[1].includes('request_source=200'))
})

test('a single 403 does not stop image extraction, and wrong post IDs are rejected', async () => {
  let browserCalls = 0
  const result = await resolveShare(source, {
    fetcher: async (url) => {
      if (String(url) === source) throw new Error('HTTP 403')
      if (String(url).includes('request_source=200'))
        return {
          buffer: Buffer.from(
            JSON.stringify({ aweme_details: [{ ...post, awemeId: '9999999999999999999' }] }),
          ),
          url: String(url),
        }
      throw new Error('endpoint unavailable')
    },
    browserReader: async (_id, { parse }) => {
      browserCalls++
      return parse(streamed, source)
    },
  })
  assert.equal(result.images.length, 3)
  assert.equal(browserCalls, 1)
})

test('valid image endpoint data is preferred and cancelling never starts a browser', async () => {
  let browserCalls = 0
  const options = {
    fetcher: async (url) =>
      String(url) === source
        ? shell
        : { buffer: Buffer.from(JSON.stringify({ aweme_details: [post] })), url: String(url) },
    browserReader: async () => {
      browserCalls++
      return null
    },
  }
  assert.equal((await resolveShare(source, options)).images.length, 3)
  assert.equal(browserCalls, 0)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(resolveShare(source, { ...options, signal: controller.signal }), {
    name: 'AbortError',
  })
  assert.equal(browserCalls, 0)
})

test('exhausted attempts do not falsely claim that login is required', async () => {
  await assert.rejects(
    resolveShare(source, {
      fetcher: async (url) =>
        String(url) === source ? shell : { buffer: Buffer.from('{}'), url: String(url) },
      browserReader: async () => null,
    }),
    /暂未读取到对应作品/,
  )
})

test('browser fallback accepts only numeric Douyin posts and platform resource domains', () => {
  assert.equal(douyinItem(source), id)
  assert.equal(douyinItem(`https://www.douyin.com/jingxuan?modal_id=${id}`), id)
  assert.equal(douyinItem(`https://douyin.com.evil.example/note/${id}`), null)
  assert.equal(douyinItem('https://www.douyin.com/note/not-an-id'), null)
  assert.equal(allowedBrowserUrl(`https://www.douyin.com/note/${id}`, true), true)
  assert.equal(allowedBrowserUrl('https://lf-douyin-pc-web.douyinstatic.com/assets.js'), true)
  for (const url of [
    'https://127.0.0.1/',
    'https://douyin.com.evil.example/',
    'https://unrelated.example/',
    'file:///secret',
    'http://www.douyin.com/',
    'https://www.douyin.com:8443/',
    'https://www.douyin.com/passport/login',
  ])
    assert.equal(allowedBrowserUrl(url, true), false, url)
})
