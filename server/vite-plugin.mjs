import { createVideoApi } from './video-api.mjs'

export function videoApiPlugin() {
  return {
    name: 'clearify-video-api',
    configureServer(server) {
      server.middlewares.use(createVideoApi())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createVideoApi())
    },
  }
}
