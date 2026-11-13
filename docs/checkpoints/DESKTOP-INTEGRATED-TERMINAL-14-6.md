# AI Dev World — Etapa 14.6: Terminal Integrado ao Escritório

**Data:** 2026-11-13  
**Branch:** `etapa-14-6-integrated-terminal`  

---

## 1. Arquitetura
- **Backend (`server/src/terminal/manager.ts`):**
  - Reutiliza `TerminalManager`, `node-pty`, `liveRedaction` (256KB scrollback) e o protocolo WebSocket existente (`terminal-open`, `terminal-data`, `terminal-resize`, `terminal-close`, `terminal-exit`).
  - Sessões pessoais usam prefixo `user:<n>` e iniciam o shell nativo (`powershell.exe` no Windows, `$SHELL || /bin/bash` no Linux) diretamente em `projects.active()?.path`, sem interpolar `cd` e sem executar comandos iniciais.
- **Frontend (`web/src/ui/TerminalDock.tsx` + `web/src/App.tsx`):**
  - Dock inferior acoplado ao escritório Phaser, redimensionável verticalmente (160px–65%), recolhível via botão ou `Ctrl+J`, mantendo `TerminalView` montado para não encerrar o PTY nem recriar o Phaser.
  - Suporta múltiplas abas pessoais (`Meu Terminal`, `Terminal 2`, ...).

## 2. Segurança e Limitações
- O terminal pessoal executa com as permissões do usuário do sistema operacional; a pasta inicial não constitui sandbox.
- Não cria API HTTP genérica de execução de comandos.
- Abas de agentes continuam isoladas no painel lateral existente; agentes não podem injetar comandos no terminal pessoal.

## 3. Testes e Pendências
- `npm.cmd run check` (inclui `TerminalDock.test.tsx`) e `cargo test`.
- Validação visual/manual em VM Windows limpa (execução de `git init`, atualização do Git Control, System Tray com terminal ativo) segue pendente antes da beta.
