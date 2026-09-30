import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVideoApi } from './video-api.mjs'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const api = createVideoApi()
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
}
const server = createServer(
  (request, response) =>
    void api(request, response, async () => {
      try {
        if (!['GET', 'HEAD'].includes(request.method)) {
          response.writeHead(405)
          response.end()
          return
        }
        const pathname = decodeURIComponent(
          new URL(request.url || '/', 'http://localhost').pathname,
        )
        let file = resolve(root, '.' + pathname)
        if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) {
          response.writeHead(403)
          response.end()
          return
        }
        try {
          if (!(await stat(file)).isFile()) file = resolve(root, 'index.html')
        } catch {
          if (extname(pathname)) {
            response.writeHead(404)
            response.end()
            return
          }
          file = resolve(root, 'index.html')
        }
        const data = await readFile(file)
        response.writeHead(200, {
          'Content-Type': types[extname(file)] || 'application/octet-stream',
          'Content-Length': data.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        })
        response.end(request.method === 'HEAD' ? undefined : data)
      } catch {
        response.writeHead(500)
        response.end('Please run npm run build before starting the server.')
      }
    }),
)
const port = Number(process.env.PORT || 5173)
server.listen(port, '0.0.0.0', () => console.log(`Clearify: http://localhost:${port}`))
