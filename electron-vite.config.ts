import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [/\.node$/]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [react()],
    server: {
      // Explicit IPv4 — on Linux 'localhost' can resolve to ::1 (IPv6)
      // while Electron's renderer connects via 127.0.0.1, causing ECONNREFUSED
      host: '127.0.0.1',
      strictPort: false
    }
  }
})
