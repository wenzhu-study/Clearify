import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { videoApiPlugin } from './server/vite-plugin.mjs'

export default defineConfig({ plugins: [react(), videoApiPlugin()] })
