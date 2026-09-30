import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createVideoApi } from '../video-api.mjs'

test('API produces opaque media handles, validates downloaded content, and rejects cross-origin use', async () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  let count = 0
  const server = createServer(
    createVideoApi({
      resolver: async () => ({
        kind: 'gallery',
        title: '测试相册',
        source: 'https://example.com/share',
        images: ['https://cdn.example.com/a.png'],
      }),
      fetcher: async () => {
        count++
        return { buffer: png, type: 'image/png', url: 'https://cdn.example.com/a.png' }
      },
    }),
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const resolved = await fetch(`${base}/api/video/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'https://example.com/share' }),
    })
    assert.equal(resolved.status, 200)
    const result = await resolved.json()
    assert.match(result.images[0], /^\/api\/video\/assets\/[a-f0-9]{48}$/)
    const image = await fetch(base + result.images[0])
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)
    await (await fetch(base + result.images[0])).arrayBuffer()
    assert.equal(count, 1)
    assert.equal((await fetch(`${base}/api/video/assets/${'a'.repeat(48)}`)).status, 410)
    const crossOrigin = await fetch(`${base}/api/video/resolve`, {
      method: 'POST',
      headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(crossOrigin.status, 403)
    assert.equal(
      (
        await fetch(`${base}/api/video/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'oops',
        })
      ).status,
      400,
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
