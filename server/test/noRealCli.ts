// Carregado antes de todo teste automatizado (node --import). Força o modo simulado com uma pasta
// sem executáveis: qualquer tentativa de achar um CLI devolve "não encontrado" em vez do CLI real.
// Testes de integração com CLI real exigem AIDW_ALLOW_REAL_CLI=1 explícito e configuração própria.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.AIDW_ALLOW_REAL_CLI !== '1') {
  process.env.AIDW_CLI_MODE = 'simulated'
  if (!process.env.AIDW_SIMULATED_CLI_DIR) process.env.AIDW_SIMULATED_CLI_DIR = mkdtempSync(path.join(tmpdir(), 'aidw-no-real-cli-'))
}
