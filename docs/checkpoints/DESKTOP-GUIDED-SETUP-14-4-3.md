# AI Dev World — Etapa 14.4.3: Instalação e Configuração Guiada de Ferramentas

**Data:** 2026-11-13  
**Branch:** `etapa-14-4-3-guided-cli-setup`  

---

## 1. Arquitetura e Catálogo Fixo
- **Catálogo (`server/src/toolSetupCatalog.ts`):**
  - `git` (`winget` `Git.Git`), `codex` (`npm` `@openai/codex`), `gemini` (`npm` `@google/gemini-cli`), `claude` (`winget` `Anthropic.ClaudeCode`).
  - Consentimento de uso único (`issueSetupConsent` → `consentNonce` com TTL 60s, escopo por `toolId`, proteção contra replay).
  - Endpoints: `GET /api/setup/catalog`, `POST /api/setup/consent`, `POST /api/setup/install`.

## 2. Segurança e Autenticação dos Provedores
- Separa instalação de autenticação: nunca coleta tokens, cookies ou API keys, e nunca ativa cobrança automática.
- Para CLIs instaladas, informa `needs_auth` com instrução oficial de login no terminal.

## 3. Interface, Testes e Build (14.4.3.2)
- **UI (`web/src/ui/FirstRunWizard.tsx` + `web/src/net/useServer.ts` + `web/src/App.tsx`):**
  - Carrega `/api/diagnostics` e `/api/setup/catalog` com Bearer em memória.
  - Exibe botão `Instalar...` para ferramentas ausentes, painel de consentimento explícito (fornecedor, método, alterações, pré-requisitos, Cancelar / Confirmar instalação) e revalida diagnóstico após concluir.
- **Testes e Build:**
  - `npm.cmd run check`: **378/378** passando (**299** server + **79** web), `oxlint` **0 warnings / 0 erros**.
  - `npx.cmd tauri build --bundles nsis`: **exit code 0** (`AI Dev World_0.1.0_x64-setup.exe`, `31.52 MiB`).
- **Limitação / Pendência:**
  - Confirmação nativa via diálogo Tauri/OS antes de instalações reais e teste em VM Windows limpa seguem pendentes antes da Etapa 14.5.
