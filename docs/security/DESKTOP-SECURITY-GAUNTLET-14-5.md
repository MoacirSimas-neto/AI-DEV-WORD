# AI Dev World — Desktop Security Gauntlet (Etapa 14.5)

**Data:** 2026-11-13  
**Branch:** `etapa-14-5-desktop-security-gauntlet`  
**Veredicto:** **GO WITH CONDITIONS** (controles de segurança verificados e testados; distribuição beta permanece bloqueada até assinatura digital Authenticode e validação em VM Windows limpa).

---

## 1. Fronteiras de Confiança Auditadas
1. **WebView2 (JS) ↔ Tauri/Rust:** `src-tauri/capabilities/default.json` concede apenas `core:default` e `dialog:allow-open` na janela `main`. O segredo `AIDW_DESKTOP_BOOTSTRAP_SECRET` nunca é exposto ao JavaScript.
2. **Tauri/Rust ↔ Node Sidecar:** bootstrap e consentimento de instalação (`confirm_tool_install` → `POST /api/setup/consent`) usam `x-aidw-desktop-secret` em `127.0.0.1` + Windows Job Object (`KILL_ON_JOB_CLOSE`).
3. **Frontend ↔ Backend HTTP/WS:** token Bearer em memória (`desktopTokenRef.current`), validação de `Origin`, `POST /api/setup/install` exige `consentNonce` de uso único (TTL 60s, escopo por `toolId`).
4. **Backend ↔ SO / Workspaces:** `project-add` / `project-validate` validam diretórios reais via `realpathSync.native()`; instalações usam catálogo fixo (`TOOL_SETUP_CATALOG`) e `execFile` sem `shell: true` genérico.

## 2. Testes Adversariais Adicionados (`server/src/securityGauntlet.test.ts`)
- Acesso não autenticado (`401`) em `/api/diagnostics`, `/api/setup/catalog`, `/api/setup/install`.
- Tentativa de emitir `/api/setup/consent` sem `x-aidw-desktop-secret` em modo desktop (mesmo com Bearer válido) → bloqueado com `403`.
- `Origin` falsificado em `/api/setup/install` → bloqueado com `403`.
- Uso de `consentNonce` para ferramenta diferente da autorizada → bloqueado com `403`.

## 3. Bloqueadores Pré-Beta (Pendentes)
1. **Assinatura digital Authenticode** do executável e do `setup.exe`.
2. **Validação em VM Windows limpa** (instalação, onboarding, diálogo nativo, tray, desinstalação e métricas reais de RAM/CPU).
