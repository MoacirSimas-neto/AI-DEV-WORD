# AI Dev World — Etapa 14.4.3: Instalação e Configuração Guiada de Ferramentas

**Data:** 2026-11-13  
**Branch:** `etapa-14-4-3-guided-cli-setup`  

---

## 1. Arquitetura e Catálogo Fixo
- **Backend (`server/src/toolSetupCatalog.ts`):**
  - Catálogo fixo (`TOOL_SETUP_CATALOG`) para `git` (`winget` `Git.Git`), `codex` (`npm` `@openai/codex`), `gemini` (`npm` `@google/gemini-cli`) e `claude` (`npm` `@anthropic-ai/claude-code`).
  - Nenhuma entrada arbitrária do frontend é aceita; argumentos são fixos e executados via `execFile` sem `shell: true` genérico.
  - Exige `confirmed === true`, bloqueia instalações concorrentes (`409`), recusa sobrescrever ferramentas já instaladas (`already_installed`) e re-executa `probeTool` após instalar.
- **Endpoints (`server/src/server.ts`):**
  - `GET /api/setup/catalog` e `POST /api/setup/install` protegidos por `hasValidSessionToken(req)` + validação de `Origin`.

## 2. Segurança e Autenticação dos Provedores
- Separa instalação de autenticação: nunca coleta tokens, cookies ou API keys, e nunca ativa cobrança automática.
- Para CLIs instaladas, informa `needs_auth` com instrução oficial de login no terminal.

## 3. Limitações e Pendências
- **UI de instalação guiada no `FirstRunWizard`:** o catálogo e o endpoint backend estão prontos e testados; a integração do botão "Instalar" + modal de consentimento no `FirstRunWizard.tsx` e o `tauri build` pós-hardening ficam como próximo passo imediato antes da Etapa 14.5.
- **VM Windows limpa:** validação real de `winget` / `npm` em máquina limpa segue pendente de autorização humana.
