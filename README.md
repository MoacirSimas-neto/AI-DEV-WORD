# AI Dev World

Escritório 2D em pixel art onde cada personagem é um agente de IA real: clicar
nele abre um terminal de verdade rodando o CLI oficial (Codex ou Gemini) na
pasta do seu projeto. Roda inteiro na sua máquina.

| Personagem | Papel               | CLI    |
| ---------- | ------------------- | ------ |
| Arquiteto  | Planeja a solução   | Gemini |
| Dev        | Implementa o código | Codex  |
| QA         | Revisa e testa      | Gemini |
| Tutor      | Explica e ensina    | Gemini |

Cada personagem pode abrir uma sessão individual e interativa de terminal, ou
participar da orquestração automática no **Modo Equipe** (Gemini planeja ->
aprovação humana -> Codex desenvolve -> Gemini revisa).

## Requisitos

- Node.js 22.18 ou mais novo (testado no 24).
- [Codex CLI](https://github.com/openai/codex) e
  [Gemini CLI](https://github.com/google-gemini/gemini-cli) instalados e com
  login feito pelo próprio CLI (`codex login`, `gemini`). Um personagem cujo CLI
  não está instalado aparece como "Indisponível".
- Git instalado e disponível no PATH.
- Linux: o `node-pty` é compilado na instalação, então são necessários
  `build-essential` e Python, e o npm pode pedir para aprovar o script de
  instalação dele (`npm approve-scripts node-pty`).

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173, adicione a pasta de um projeto na barra do topo.

- Para terminal interativo: clique em um personagem e use "Iniciar sessão".
- Para tarefas e modo equipe: clique em "Tarefas" na barra do topo.
- Para histórico de atividades: clique em "Histórico" na barra do topo.
- Para controle de versão: clique em "Alterações" na barra do topo.

Verificações de integridade:
```bash
npm run check
```
Roda typecheck do server/web, build do Vite, lint (oxlint) e suíte de testes.

## O que significam os estados

| Estado               | Significado                                            | No mundo             |
| -------------------- | ------------------------------------------------------ | -------------------- |
| Indisponível         | CLI não encontrado no PATH                             | parado, "zzz"        |
| Disponível (Ocioso)  | CLI pronto, sem sessão ou missão aberta                | passeia pelo tapete  |
| Aguardando você      | sessão de terminal aberta, sem saída recente           | na mesa, "?"         |
| Trabalhando          | sessão aberta escrevendo no terminal ou Dev codando    | na mesa, digitando   |
| Planejando           | Arquiteto (Gemini) analisando projeto e criando plano  | na mesa, "💡"        |
| Aguardando aprovação | plano pronto no modo equipe esperando decisão humana   | na mesa, "✋"        |
| Revisando            | QA (Gemini) analisando qualidade, testes e segurança   | na mesa, "🔍"        |
| Concluído            | etapa do agente terminada com sucesso                  | na mesa, "✔"         |
| Erro                 | falha de execução, cota excedida ou erro de CLI        | alerta "!"           |

## Funcionalidades

### 1. Terminais Individuais
- Pseudo-terminal real via `node-pty` e `xterm.js`.
- Sessão mantida no backend: recarregar o navegador não encerra processos.
- Execução isolada na pasta autorizada do projeto selecionado.

### 2. Gerenciamento de Tarefas
- CRUD completo (criar, editar, excluir, status e prioridades).
- Vinculação ao projeto ativo e atribuição a agentes específicos.
- Persistência no mesmo banco local SQLite.

### 3. Modo Equipe (Agentes Reais)
- **Fluxo Oficial:** Gemini (Arquiteto) → Codex (Dev) → Gemini (QA).
- **Etapa 1 — Planejamento:** Gemini inspeciona o projeto e gera plano de implementação.
- **Aprovação Humana:** O plano é exibido na interface para aprovação ou cancelamento do usuário.
- **Etapa 2 — Desenvolvimento:** Codex implementa as mudanças com sandbox `workspace-write`.
- **Etapa 3 — Revisão:** Gemini recebe o diff das alterações e emite parecer e veredito (`APROVADO` / `REPROVADO`).
- Proteção contra execuções simultâneas e cancelamento limpo de processos com `taskkill` no Windows e `SIGTERM` no Linux.

### 4. Histórico de Atividades
- Histórico persistente que sobrevive ao reinício do sistema.
- Gravação de tarefas, mudanças de status, execuções de agentes, commits, pushes e erros.
- Filtro por tipo de atividade na interface.
- Sanitização ativa contra segredos (`redact`): chaves de API, senhas e tokens não são persistidos nem expostos.

### 5. Painel Git Integrado
- Leitura em tempo real do estado do repositório (branch, upstream, ahead/behind, arquivos).
- Visualização de diffs com destaque de sintaxe.
- Preparar (`git add`) e tirar (`git restore`/`git rm`) arquivos.
- Criação de commits com registro no histórico.
- Envio remoto (`git push`) com confirmação obrigatória de dois passos via token temporário.

## Estrutura

```
shared/protocol.ts        contrato de tipos WebSocket (mensagens, tarefas, missões, Git)
server/src/
  cli/                    detecção e execução dos CLIs (tratamento .cmd Windows e startCli com stdin)
  agents/registry.ts      fonte da verdade do estado dos agentes
  terminal/               sessões de pseudo-terminal (node-pty)
  projects/store.ts       gerenciamento de projetos autorizados (SQLite)
  tasks/store.ts          persistência de tarefas e missões (SQLite)
  history/store.ts        histórico de atividades e sanitização de segredos (redact)
  team/runner.ts          orquestrador do Modo Equipe (Gemini -> Codex -> Gemini)
  team/prompts.ts         templates de prompts dos papéis do modo equipe
  git/service.ts          operações Git seguras e não destrutivas
  server.ts               servidor HTTP + WebSocket local
web/src/
  net/useServer.ts        conexão reativa com WebSocket
  net/useGitStatus.ts     polling de alterações do Git
  game/                   escritório Phaser 2D, layout pixel art e atores
  ui/                     componentes React (ProjectBar, TaskPanel, HistoryPanel, GitPanel, TerminalView)
```

## Segurança

- O backend escuta estritamente em `127.0.0.1` e valida os cabeçalhos `Host` e `Origin` (`localhost:5173`).
- Sem armazenamento de senhas ou tokens no app; utiliza a autenticação existente dos CLIs.
- Todo texto que entra no histórico é filtrado pelo sanitizador de credenciais (`redact`).
- Pushes e comandos com impacto externo exigem confirmação explícita do usuário.
- CLIs só são executados dentro dos diretórios expressamente autorizados na lista de projetos.

## Status das Funcionalidades

| Funcionalidade                     | Status               |
| ---------------------------------- | -------------------- |
| Terminais reais por agente         | Concluído            |
| Detecção de CLIs oficiais          | Concluído            |
| Gerenciamento de tarefas local     | Concluído            |
| Histórico de atividades com filtro | Concluído            |
| Sanitização de segredos em logs    | Concluído            |
| Modo Equipe com agentes reais      | Concluído            |
| Aprovação humana no fluxo equipe   | Concluído            |
| Painel Git (diff, commit, push)    | Concluído            |
| Estados integrados no mundo 2D     | Concluído            |
| Empacotamento Desktop (Tauri/Elec) | Pendente para futuro |
