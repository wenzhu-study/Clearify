import test from 'node:test'
import assert from 'node:assert/strict'
import { assignedJson, parsePage, resolveShare } from '../parse.mjs'
import {
  extractShareUrl,
  isPublicAddress,
  resolveAddress,
  sniffMedia,
  validateUrl,
} from '../remote.mjs'

test('extracts a URL from copied share text and strips surrounding punctuation', () => {
  assert.equal(
    extractShareUrl('9.41 钢琴教学 #谱子 https://v.douyin.com/abc123/ 复制打开抖音').href,
    'https://v.douyin.com/abc123/',
  )
  assert.equal(
    extractShareUrl('看看 https://example.com/video.mp4）。').href,
    'https://example.com/video.mp4',
  )
  assert.throws(() => extractShareUrl('只有文案没有链接'), /没有找到链接/)
})

test('rejects local/private/special addresses and unsafe URL forms', async () => {
  for (const url of [
    'http://localhost/foo',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://192.168.1.2',
    'http://169.254.169.254',
    'http://100.64.0.2',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'http://example.com:8080',
  ])
    assert.throws(() => validateUrl(url))
  for (const ip of [
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    'fc00::1',
    'fe80::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip)
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  await assert.rejects(
    resolveAddress('example.com', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /非公开/,
  )
  assert.equal(
    (await resolveAddress('example.com', async () => [{ address: '8.8.8.8', family: 4 }])).address,
    '8.8.8.8',
  )
})

test('parses hydration JSON without executing code or altering quoted undefined text', () => {
  const input =
    'window.__INITIAL_STATE__ = {"note":{"description":"undefined is a word","other":undefined,"deep":{"a":[1,2]}},"quote":"a \\\" bracket }"}; alert(1);'
  const result = assignedJson(input, /window\.__INITIAL_STATE__\s*=/)
  assert.equal(result.note.other, null)
  assert.equal(result.note.description, 'undefined is a word')
  assert.deepEqual(result.note.deep.a, [1, 2])
  assert.equal(
    assignedJson(
      'window.__INITIAL_STATE__ = {"a": process.exit()}',
      /window\.__INITIAL_STATE__\s*=/,
    ),
    null,
  )
})

test('extracts ordered gallery originals from Douyin share data, without avatars or recommendations', () => {
  const data = {
    loaderData: {
      'note/page': {
        videoInfoRes: {
          item_list: [
            {
              aweme_id: '12345',
              desc: '钢琴教学',
              author: {
                nickname: '老师',
                avatar: { url_list: ['https://cdn.example.com/avatar.jpg'] },
              },
              images: [
                {
                  url_list: [
                    'https://cdn.example.com/one.jpg',
                    'https://backup.example.com/one.jpg',
                  ],
                },
                { url_list: ['https://cdn.example.com/two.jpg'] },
              ],
            },
          ],
        },
        recommendations: [
          { aweme_id: '999', images: [{ url_list: ['https://cdn.example.com/wrong.jpg'] }] },
        ],
      },
    },
  }
  const html = `<script>window._ROUTER_DATA = ${JSON.stringify(data)};</script>`
  assert.deepEqual(parsePage(html, 'https://www.iesdouyin.com/share/slides/12345/'), {
    kind: 'gallery',
    title: '钢琴教学',
    author: '老师',
    images: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
  })
})

test('extracts Xiaohongshu gallery originals and distinguishes a video cover from frames', () => {
  const note = {
    noteId: 'abc123',
    type: 'normal',
    title: '旅行日记',
    imageList: [
      { urlDefault: 'https://cdn.example.com/a.webp' },
      { urlDefault: 'https://cdn.example.com/b.webp' },
    ],
  }
  const html = `<script>window.__INITIAL_STATE__=${JSON.stringify({ note: { noteDetailMap: { abc123: { note } } } })}</script>`
  assert.equal(parsePage(html, 'https://www.xiaohongshu.com/explore/abc123').images.length, 2)
  note.type = 'video'
  note.video = {
    media: { stream: { h264: [{ masterUrl: 'https://cdn.example.com/video.mp4', width: 1920 }] } },
  }
  const videoHtml = `<script>window.__INITIAL_STATE__=${JSON.stringify({ note: { noteDetailMap: { abc123: { note } } } })}</script>`
  const result = parsePage(videoHtml, 'https://www.xiaohongshu.com/explore/abc123')
  assert.equal(result.kind, 'video')
  assert.equal(result.video, 'https://cdn.example.com/video.mp4')
})

test('reads public video metadata while refusing to treat a cover image as extracted frames', () => {
  assert.deepEqual(
    parsePage(
      '<title>示例</title><video><source src="/video.mp4"></video>',
      'https://example.com/watch',
    ),
    { kind: 'video', title: '示例', video: 'https://example.com/video.mp4' },
  )
  assert.equal(
    parsePage(
      '<meta property="og:image" content="https://example.com/cover.jpg"><img src="avatar.jpg">',
      'https://example.com/watch',
    ),
    null,
  )
  assert.deepEqual(
    parsePage(
      '<script type="application/ld+json">{"@type":"ImageGallery","name":"相册","image":["/a.png","/b.png"]}</script>',
      'https://example.com/share',
    ),
    {
      kind: 'gallery',
      title: '相册',
      images: ['https://example.com/a.png', 'https://example.com/b.png'],
    },
  )
})

test('direct videos are identified by bytes and inaccessible pages fail explicitly', async () => {
  const mp4 = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32', 'hex')
  assert.equal(sniffMedia(mp4), 'video/mp4')
  const result = await resolveShare('视频 https://example.com/movie', {
    fetcher: async () => ({
      buffer: mp4,
      type: 'application/octet-stream',
      url: 'https://example.com/movie',
    }),
  })
  assert.equal(result.kind, 'video')
  assert.equal(result.direct.buffer, mp4)
  await assert.rejects(
    resolveShare('https://example.com/private', {
      fetcher: async () => ({
        buffer: Buffer.from('<title>需要登录</title>'),
        type: 'text/html',
        url: 'https://example.com/private',
      }),
    }),
    /没有读到/,
  )
})
