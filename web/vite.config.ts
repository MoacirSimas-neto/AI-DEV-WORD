/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// AIDW_PORT / AIDW_WEB_PORT permitem uma instância isolada (ex.: validação) ao lado da principal.
const BACKEND = `http://127.0.0.1:${process.env.AIDW_PORT ?? 4517}`
const WEB_PORT = Number(process.env.AIDW_WEB_PORT ?? 5173)
const DATA_DIR = process.env.AIDW_DATA_DIR || path.join(os.homedir(), '.ai-dev-world')
const TOKEN_FILE = path.join(DATA_DIR, 'session-token')
const DEV_ORIGINS = new Set([`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`])

// O navegador fala só com o Vite; /api e /ws são repassados ao backend local.
// strictPort: a porta da interface faz parte da lista de origens aceitas pelo backend.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': BACKEND,
      '/ws': {
        target: BACKEND,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq, req) => {
            const origin = req.headers.origin
            if (!origin || !DEV_ORIGINS.has(origin)) return
            try {
              const token = readFileSync(TOKEN_FILE, 'utf8').trim()
              if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`)
            } catch {
              // Backend ainda não iniciou ou sem token; o backend recusará com 401.
            }
          })
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
