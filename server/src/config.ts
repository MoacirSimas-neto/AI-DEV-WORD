import { homedir } from 'node:os'
import path from 'node:path'

// O servidor só escuta em loopback e só aceita páginas servidas pelo Vite local.
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.AIDW_PORT ?? 4517)
export const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

// Pasta onde os CLIs são iniciados. Provisório: a etapa de projetos troca isto
// por uma lista de diretórios autorizados pelo usuário.
export const WORKDIR = process.env.AIDW_WORKDIR ?? path.join(homedir(), 'ai-dev-world-workspace')
