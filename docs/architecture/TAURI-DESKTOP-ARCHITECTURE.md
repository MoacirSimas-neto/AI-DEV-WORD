# Arquitetura Desktop Tauri 2 — AI Dev World (Etapa 14.0)

> **Status:** Proposta técnica consultiva (`PENDENTE DE APROVAÇÃO HUMANA`). Nenhuma implementação Tauri foi iniciada.

## 1. Visão Geral & Fronteiras
Preserva integralmente `web/` (React + TypeScript + Vite + Phaser 2D) e `server/` (Node.js + TypeScript + `node:sqlite` + `ws` + `node-pty` + `ProcessSupervisor`), adicionando `src-tauri/` (Tauri 2 / Rust) como shell desktop.

```
+-------------------------------------------------------------------+
| Tauri 2 (Rust) - Processo Principal                               |
| - Gera sessionToken efêmero no boot                               |
| - Inicia sidecar Node (porta loopback livre + token via env)      |
| - Encerra sidecar + árvore de filhos no fechamento                |
| - Expõe comando IPC mínimo: get_session_config()                  |
+---------------------------------+---------------------------------+
                                  | IPC (Tauri invoke)
                                  v
+---------------------------------+---------------------------------+
| WebView2 (Windows) / WebKitGTK (Linux)                            |
| - Assets estáticos de web/dist (sem Vite dev server)              |
| - React + Phaser 2D + xterm.js                                    |
| - CSP estrita: connect-src ws://127.0.0.1:<port> http://127.0.0.1:<port> |
+---------------------------------+---------------------------------+
                                  | WebSocket (Sec-WebSocket-Protocol: aidw-auth,<token>)
                                  v
+---------------------------------+---------------------------------+
| Sidecar Node.js (server/) - 127.0.0.1:<port>                      |
| - Valida token + Host + Origin                                    |
| - SQLite (node:sqlite), GitService (realpathSync), TeamRunner     |
| - ProcessSupervisor (Named Pipe Windows / dir 0o700 Unix)         |
| - CLIs externas (codex, gemini, agy, git) + node-pty              |
+-------------------------------------------------------------------+
```

## 2. Decisões Críticas (Resumo)
- **Empacotamento Node (`DECISÃO PROVISÓRIA` — requer PoC na 14.2):** Runtime Node empacotado + `server/dist` + `node_modules` (`node-pty` nativo `.node`). **Não recomendado:** Node SEA (incompatibilidade/complexidade com addon nativo `node-pty` e `node:sqlite`).
- **Comunicação (`RECOMENDAÇÃO TÉCNICA` — pendente aprovação):** Arquitetura híbrida: Tauri IPC apenas para bootstrap (`get_session_config` retornando `{ port, token }`), mantendo WebSocket local autenticado para streaming de PTY, Phaser, Chat e Missões.
- **Autenticação Desktop (`RECOMENDAÇÃO TÉCNICA` — pendente aprovação):** Rust gera `sessionToken` (`randomBytes(32)`), passa ao sidecar via `AIDW_AUTH_TOKEN` (env privado do processo filho) e entrega à WebView via IPC `get_session_config()`. Elimina pareamento manual no desktop sem embutir segredo no bundle.
- **Ciclo de Vida (`RECOMENDAÇÃO TÉCNICA`):** Rust gerencia spawn/restart/shutdown do sidecar Node; Node mantém `ProcessSupervisor` para CLIs e PTYs filhos.
