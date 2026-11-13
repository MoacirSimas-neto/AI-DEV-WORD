# Roadmap Etapa 14 — AI Dev World Desktop

- **14.1 — Shell Desktop:** Criar `src-tauri/` (Tauri 2) carregando `web/dist` no WebView2. Critério: janela abre com React + Phaser 2D sem erro.
- **14.2 — Backend Node Sidecar:** Empacotar runtime Node + `server/dist` + `node-pty` + `node:sqlite`, com PoC de build/execução e cleanup de processos.
- **14.3 — Segurança e Integração:** IPC `get_session_config`, token efêmero, capabilities mínimas, CSP estrita e validação E2E.
- **14.4 — Instalador e Primeira Execução:** Instalador NSIS (`perUser`), assistente de onboarding para Git/CLIs, plano de atualizações assinadas.
- **14.5 — Security Gauntlet Desktop (Obrigatório antes da Beta):** Auditoria Cloudflare completa do binário, instalador, Rust, IPC, sidecar e supply chain.
- **15 — Beta Fechada:** Distribuição controlada para proprietário e amigos com assinatura de código e rollback.
