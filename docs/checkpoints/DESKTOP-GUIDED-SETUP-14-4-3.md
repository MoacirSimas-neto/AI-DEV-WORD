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

## 3. Limitações e Pendências
- **UI de instalação guiada no `FirstRunWizard`:** o catálogo e o endpoint backend estão prontos e testados; a integração do botão "Instalar" + modal de consentimento no `FirstRunWizard.tsx` e o `tauri build` pós-hardening ficam como próximo passo imediato antes da Etapa 14.5.
- **VM Windows limpa:** validação real de `winget` / `npm` em máquina limpa segue pendente de autorização humana.
