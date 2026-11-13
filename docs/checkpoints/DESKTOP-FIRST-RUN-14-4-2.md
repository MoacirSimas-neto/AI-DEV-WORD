# AI Dev World — Etapa 14.4.2: Assistente de Primeira Execução (Onboarding & Diagnóstico)

**Data:** 2026-11-13  
**Branch:** `etapa-14-4-2-first-run-wizard`  

---

## 1. Arquitetura do Assistente
- **Backend (`server/src/environmentDiagnostics.ts` + `GET /api/diagnostics`):**
  - Sonda segura sem `shell: true` (`execFile` com `timeout: 2500ms`, `windowsHide: true`; suporte a `.cmd`/`.bat` via `cmd.exe /d /c` com argumentos em array).
  - Detecta **Git**, **Codex CLI**, **Gemini CLI** e **Claude Code CLI** (caminho + `--version`), diferenciando `ready`, `not_installed`, `needs_auth`, `unavailable` e `error`.
  - Nunca lê tokens/arquivos privados de provedores e nunca inicia sessões de IA.
  - Respeita `AIDW_CLI_MODE=simulated` / `AIDW_SIMULATED_CLI_DIR`.
- **Frontend (`web/src/ui/FirstRunWizard.tsx` + `web/src/App.tsx`):**
  - Fluxo curto em 3 etapas: **Boas-vindas** → **Diagnóstico do Ambiente** → **Configuração Inicial** (selecionar pasta/projeto ou entrar sem projeto).
  - Não bloqueia o acesso ao escritório quando Git ou CLIs estão ausentes.
  - Persistência não sensível em `localStorage` (`aidw.firstRun.v1`: `{ completed, lastStep }`).

## 2. Hardening (14.4.2.1) e Pendências para 14.4.3
- **Autenticação integrada:** `useServer.ts` expõe `fetchDiagnostics()` usando `desktopTokenRef.current` (Bearer em memória) + `credentials: 'include'`, sem expor o token aos componentes ou `localStorage`.
- **Lint:** `oxlint` com **0 warnings e 0 erros** (69 arquivos).
- **Testes:** `npm.cmd run check` com **374/374** passando (**295** server + **79** web).
- **Instalação guiada:** apenas diagnóstico implementado nesta etapa; instalação assistida de Git/CLIs pertence à Etapa 14.4.3.
- **VM Windows limpa:** validação visual/manual em ambiente sem Node/Rust segue pendente.
