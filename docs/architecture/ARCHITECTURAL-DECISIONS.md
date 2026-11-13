# Decisões Arquiteturais — Etapa 14.0

### A. Requisitos Não Negociáveis
- Preservar React, TypeScript, Vite, Phaser 2D, Node.js backend, SQLite, `ProcessSupervisor`, CLIs oficiais, aprovações humanas e identidade pixel art do Escritório 2D.
- Local-first sem nuvem própria ou assinatura.
- Tauri 2 como shell desktop (prioridade Windows, compatibilidade Linux planejada).

### B. Recomendações Técnicas (Pendentes de Aprovação Humana)
- **Comunicação:** Híbrida — Tauri IPC apenas para bootstrap (`get_session_config`) + WebSocket local autenticado para streaming/estado.
- **Autenticação Desktop:** Token efêmero gerado pelo Rust, passado ao sidecar via env e à WebView via IPC.
- **Instalador Windows:** NSIS (`perUser`, sem exigir admin) para a beta fechada.
- **Atualizações:** Tauri Updater com assinatura criptográfica dedicada + assinatura de código Windows antes da beta pública.

### C. Decisões Provisórias (Requerem PoC)
- **Node Sidecar:** Runtime Node empacotado + `server/dist` + `node_modules` (`node-pty` nativo). Requer PoC na Etapa 14.2 para validar tamanho e carregamento de `.node` no Windows.

### D. Decisões Pendentes de Aprovação Humana
- Escolha entre NSIS (`perUser`) vs. MSI.
- Política de atualizações automáticas vs. manuais na beta fechada.
- Aceite do modelo híbrido IPC + WebSocket.

### E. Alternativas Rejeitadas (`NÃO RECOMENDADO`)
- **Reescrever backend em Rust:** Custo alto sem ganho funcional; quebra prazo e testes existentes (293/293).
- **Node SEA:** Risco alto de incompatibilidade com addon nativo `node-pty` e `node:sqlite`.
- **WebView com `fs`/`shell` genéricos:** Viola princípio de privilégios mínimos.
