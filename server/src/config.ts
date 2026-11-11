import { homedir } from 'node:os'
import path from 'node:path'

// O servidor só escuta em loopback e só aceita páginas servidas pelo Vite local.
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.AIDW_PORT ?? 4517)
export const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

// Dados do app (lista de projetos). Fica fora do repositório e não contém credenciais.
export const DATA_DIR = process.env.AIDW_DATA_DIR ?? path.join(homedir(), '.ai-dev-world')
export const DATABASE_FILE = path.join(DATA_DIR, 'data.sqlite')
