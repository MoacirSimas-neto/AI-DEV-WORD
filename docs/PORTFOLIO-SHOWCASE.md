# AI Dev World — Roteiro de Demonstração e Portfólio

## Roteiro de Demonstração (3–5 minutos)

1. **Abertura (0:00–0:30)**: Abrir o aplicativo desktop (`ai-dev-world.exe` ou `npm run dev`), selecionar o projeto ativo e mostrar o escritório 2D em pixel art.
2. **Central da Equipe (0:30–1:15)**: Abrir a **Central da Equipe** e navegar pelas três sub-abas:
   - **Agentes**: mostrar os 4 agentes padrão (`Arquiteto` como Tech Lead, `Dev`, `QA`, `Tutor`) e a criação/edição com preview pixel art.
   - **Skills**: mostrar a biblioteca de skills e o botão `+ Adicionar Skill` (skills importadas entram desativadas por padrão).
   - **Memória**: mostrar memórias por projeto vs. compartilhadas da equipe.
3. **Chat com Tech Lead → Missão (1:15–2:15)**: Na aba **Chat**, conversar com o Tech Lead sobre uma tarefa e clicar em **Preparar missão** (com confirmação explícita).
4. **Aprovação Humana e Execução (2:15–3:30)**: Mostrar a proposta estruturada validada pelo backend (`<<<PROPOSTA ... PROPOSTA>>>`), aprovar o plano, acompanhar a delegação ao Developer, criação/edição de arquivos e validação do QA.
5. **Terminais, Git e Observabilidade (3:30–4:30)**:
   - Abrir o **Terminal Dock** inferior (`Ctrl+J`) no escritório.
   - Abrir o painel **Git Control** para inspecionar diff/status sem commits automáticos.
   - Abrir **Observabilidade** para mostrar a trilha de eventos (`observed` vs. `declared`).

---

## Materiais para Produzir (Capturas Reais)

- Screenshot 1: Escritório 2D + Terminal Dock inferior aberto (`Ctrl+J`).
- Screenshot 2: Central da Equipe — sub-aba **Agentes** com editor e preview pixel art.
- Screenshot 3: Central da Equipe — sub-aba **Skills** (`+ Adicionar Skill`) e **Memória**.
- Screenshot 4: **Gerenciador de Tarefas / Missões** com proposta aguardando aprovação humana.
- Screenshot 5: **Observabilidade** mostrando trilha de eventos de uma missão real.

*(Revisar antes de publicar para garantir ausência de caminhos pessoais sensíveis ou tokens.)*

---

## Textos para Portfólio

### GitHub (Descrição Curta)
> Local-first desktop workspace built with Tauri 2, React, TypeScript, Node.js, SQLite, and Phaser to coordinate official AI coding CLIs (Codex, Gemini, Antigravity) under strict human-in-the-loop approval, process supervision, and SHA-256 file integrity checks.

### Currículo
> **AI Dev World** — Desenvolvi uma aplicação desktop local (Tauri 2 / Rust, Node.js, SQLite WAL, React, TypeScript, Phaser, WebSocket e `node-pty`) para orquestração de múltiplos agentes via CLIs oficiais, com validação estrita de propostas no backend, supervisão de árvore de processos, isolamento de workspaces, remoção de segredos em fluxos PTY e painel de observabilidade.

### Pitch de Entrevista (~1 minuto)
> "Eu criei o AI Dev World para resolver um problema prático: usar múltiplos agentes de IA no meu próprio repositório sem pagar APIs extras e sem perder o controle do que cada agente pode alterar. Estruturei o app com um shell Tauri 2 em Rust que inicia um sidecar Node.js local com token Bearer, banco SQLite em modo WAL e frontend React + Phaser conectado por WebSocket e terminais PTY reais. O desafio técnico mais interessante foi garantir que a saída dos modelos nunca execute nada direto: o backend valida o schema das propostas, bloqueia escritas fora de passos autorizados usando hashes SHA-256 no Git, supervisona os processos filhos e pausa toda mudança de equipe ou replanejamento até aprovação humana explícita."
