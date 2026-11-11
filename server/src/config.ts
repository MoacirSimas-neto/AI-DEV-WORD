// O servidor só escuta em loopback e só aceita páginas servidas pelo Vite local.
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.AIDW_PORT ?? 4517)
export const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
