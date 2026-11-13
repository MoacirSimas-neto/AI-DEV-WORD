# Modelo de Segurança Desktop — AI Dev World (Etapa 14.0)

Baseado em `docs/checkpoints/SECURITY-BASELINE.md` e `C:\audits\ai-dev-world\run-03` (`GO WITH CONDITIONS`).

## 1. Controles Preservados da Versão Web
- **FIND-001:** Autenticação obrigatória no `/ws` (no desktop via token efêmero entregue por IPC Rust -> WebView, nunca `VITE_*`).
- **FIND-002:** `GitService.assertInside` com `realpathSync` + `previewPush` token.
- **FIND-003:** `asUntrusted(diff)` + `securityStops` + aprovações humanas no backend.
- **FIND-004:** `ProcessSupervisor` com diretório `0o700` + socket `0o600` (Unix) / Named Pipe + token 12 bytes (Windows).

## 2. Novos Controles Tauri 2 (Obrigatórios na 14.3)
- **Capabilities mínimas:** Desabilitar `fs` e `shell` genéricos na WebView; permitir apenas `core:default` e comando customizado `get_session_config`.
- **CSP estrita:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*;` (ajustar porta exata em runtime se possível).
- **Sidecar:** Validar integridade do binário/script empacotado, passar `AIDW_AUTH_TOKEN` apenas por env do processo filho (nunca CLI args ou URL), e garantir encerramento da árvore de processos no exit.
- **Supply chain:** `npm ci` com `package-lock.json` para `node-pty`, `Cargo.lock` para crates Rust, e assinatura de código antes da beta fechada (Etapa 14.5).

## 3. Limitações Conhecidas
- Processos rodando com o **mesmo usuário OS** continuam fora do limite de isolamento do app.
- Testes POSIX em Linux (`NV-001`) e testes adversariais em sandbox (`NV-002`) seguem pendentes.
