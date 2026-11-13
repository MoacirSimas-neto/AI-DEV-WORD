# Desktop Readiness — AI Dev World (Pré-Etapa 14.0)

- **Alvo futuro:** Tauri 2 (Windows WebView2 primeiro, depois Linux).
- **Status:** **Pronto para iniciar planejamento arquitetural (Etapa 14.0)** — *não pronto para distribuição pública sem cumprir as condições abaixo*.

## O que está pronto
- Separação limpa `web/` (SPA estática) ↔ `server/` (API HTTP/WS + SQLite + PTY).
- Autenticação por sessão desacoplada de `VITE_*` no bundle.
- `node:sqlite` local-first, CLIs isolados via `ProcessSupervisor`.

## Condições de Aceite para Etapa 14.0 (Tauri 2)
1. **IPC seguro para sessão:** Processo Tauri gera/repassa token ao sidecar Node e à WebView via comando IPC, eliminando pareamento manual no desktop.
2. **CSP estrita & Capabilities mínimas:** Restringir `connect-src` à porta local do sidecar e não expor `fs`/`shell` amplos à WebView.
3. **Sidecar & Ciclo de vida:** Garantir encerramento limpo do backend Node e processos filhos (`ProcessSupervisor` / `node-pty`) ao fechar a janela Tauri.
4. **Supply Chain:** Build determinístico com `npm ci` (`package-lock.json`) para `node-pty` e assinatura de binários antes de qualquer distribuição.
