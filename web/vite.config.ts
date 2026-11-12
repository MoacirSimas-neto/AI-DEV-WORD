import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// AIDW_PORT / AIDW_WEB_PORT permitem uma instância isolada (ex.: validação) ao lado da principal.
const BACKEND = `http://127.0.0.1:${process.env.AIDW_PORT ?? 4517}`
const WEB_PORT = Number(process.env.AIDW_WEB_PORT ?? 5173)

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
      '/ws': { target: BACKEND, ws: true },
    },
  },
})
