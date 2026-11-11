# AI Dev World

Escritório 2D em pixel art onde cada personagem é um agente de IA real: clicar
nele abre um terminal de verdade rodando o CLI oficial (Codex, Gemini ou Antigravity) na
pasta do seu projeto. Roda inteiro na sua máquina.

| Personagem | Papel               | CLI Padrão               |
| ---------- | ------------------- | ------------------------ |
| Arquiteto  | Planeja a solução   | Antigravity CLI (`agy`)  |
| Dev        | Implementa o código | Codex CLI                |
| QA         | Revisa e testa      | Antigravity CLI (`agy`)  |
| Tutor      | Explica e ensina    | Gemini CLI               |

Cada personagem pode abrir uma sessão individual e interativa de terminal, ou
participar da orquestração automática no **Modo Equipe** (Antigravity/Gemini planeja ->
aprovação humana -> Codex desenvolve -> Antigravity/Gemini revisa).

## Requisitos

- Node.js 22.18 ou mais novo (testado no 24).
- CLIs instalados e autenticados:
  - [Google Antigravity CLI (`agy`)](https://antigravity.google)
  - [Codex CLI](https://github.com/openai/codex) (`codex login`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
  Um personagem cujo CLI não está instalado ou sem login aparece como "Indisponível".
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
- Para central de configuração dos agentes: clique em "⚙ Central de Agentes" na barra do topo.
- Para painel Git: utilize a barra lateral direita permanente ou clique em "Git (N)" para recolher/expandir.

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

### 5. Painel Git Permanente e Inteligente
- Barra lateral direita permanente (~320px) sem sobrepor o escritório 2D, com botão de recolher/expandir.
- Estado de visibilidade salvo automaticamente em `localStorage`.
- Atualização em tempo real vinculada ao ciclo de vida dos agentes: quando o Dev conclui alterações, emite evento WebSocket `git-activity` que recarrega o status imediatamente.
- Notificação banner discreta no topo do painel ao detectar novas mudanças com opção de dispensar.
- Tonalidades visuais por tipo de alteração (Adicionado em verde, Modificado em amarelo, Removido em vermelho, Não rastreado em ciano).
- Animação pulsante suave `git-badge-new` com respeito automático a `prefers-reduced-motion`.
- Leitura em tempo real do estado do repositório (branch, upstream, ahead/behind, contadores e arquivos staged/unstaged).
- Visualização de diffs inline com destaque e opção de fechar.
- Preparar (`git add`) e tirar (`git restore`/`git rm`) arquivos individuais ou em lote.
- Criação de commits com registro no histórico.
- Envio remoto (`git push`) com confirmação obrigatória de dois passos via token temporário.

### 6. Central de Agentes (Modelos e Raciocínio)
- Painel modal acessível pela barra de navegação ("⚙ Central de Agentes").
- Três provedores oficiais independentes: **Google Antigravity CLI (`agy`)**, **Codex CLI** e **Gemini CLI**.
- Configuração individual por agente:
  - **Provedor:** Antigravity, Gemini ou Codex.
  - **Modelo:** Seleção customizável com modelos oficiais (ex: `gemini-4-argon-high`, `gemini-3.8-flash-high`, `claude-opus-5-5-high`, `gpt-5`, `gemini-2.5-pro`, etc.).
  - **Esforço de Raciocínio:** `default`, `low`, `medium`, `high`, `extra-high` (injetado via `--effort` no Antigravity e `-c model_reasoning_effort` no Codex).
- **Perfis rápidos:**
  - *Econômico:* Antigravity Flash-low / Codex mini / Gemini Flash-Lite.
  - *Balanceado:* Antigravity Argon-medium / Codex padrão / Gemini Flash.
  - *Qualidade Máxima:* Antigravity Argon-high / Codex high / Gemini Pro.
- Botão "Restaurar Padrões" para restabelecer os valores recomendados de fábrica.
- Persistência das preferências no SQLite (`agent_configs`).
- Aplicação automática tanto no **Modo Equipe** quanto nos **Terminais Interativos** (`spawnCliPty`).

### 7. Seleção Segura de Projetos (Windows & Linux)
- Seletor nativo de pastas disparado pelo botão "Procurar..." via backend (`FolderBrowserDialog` no Windows, `zenity`/`kdialog` no Linux).
- Suporte a caminhos complexos: espaços (`C:\AI DEV WORD`), aspas, barras invertidas ou normais, com resolução canônica via `path.resolve` e `fs.realpathSync.native`.
- Validação prévia de diretório com botão "Validar": informa se a pasta existe, se é diretório e se possui repositório Git com o nome da branch ativa.
- Proteção por `ErrorBoundary` no React: impede que qualquer falha localizada em subcomponentes ou incompatibilidade de estado desmonte a interface.

## Estrutura

```
shared/protocol.ts        contrato de tipos WebSocket (mensagens, tarefas, missões, Git, configs)
server/src/
  cli/                    detecção e execução dos CLIs (agy, codex, gemini com tratamento .cmd e shims)
  agents/registry.ts      fonte da verdade do estado dos agentes
  agents/configStore.ts   persistência SQLite de provedor, modelo e raciocínio por agente
  terminal/               sessões de pseudo-terminal (node-pty) com injeção de modelo/esforço
  projects/store.ts       gerenciamento de projetos autorizados (SQLite)
  tasks/store.ts          persistência de tarefas e missões (SQLite)
  history/store.ts        histórico de atividades e sanitização de segredos (redact)
  team/runner.ts          orquestrador do Modo Equipe (Antigravity -> Codex -> Antigravity/Gemini)
  team/prompts.ts         templates de prompts dos papéis do modo equipe
  git/service.ts          operações Git seguras e não destrutivas
  server.ts               servidor HTTP + WebSocket local
web/src/
  net/useServer.ts        conexão reativa com WebSocket e sanitização de snapshot
  net/useGitStatus.ts     polling de alterações do Git e evento push em tempo real
  game/                   escritório Phaser 2D, layout pixel art e atores
  ui/                     componentes React (ProjectBar, TaskPanel, HistoryPanel, GitPanel, AgentCenter, TerminalView, ErrorBoundary)
```

## Segurança

- O backend escuta estritamente em `127.0.0.1` e valida os cabeçalhos `Host` e `Origin` (`localhost:5173`).
- Sem armazenamento de senhas ou tokens no app; utiliza a autenticação existente dos CLIs.
- Todo texto que entra no histórico é filtrado pelo sanitizador de credenciais (`redact`).
- Pushes e comandos com impacto externo exigem confirmação explícita do usuário.
- CLIs só são executados dentro dos diretórios expressamente autorizados na lista de projetos.
- Modo headless do Antigravity inspeciona avisos de permissão; nunca utiliza `--dangerously-skip-permissions`.

## Status das Funcionalidades

| Funcionalidade                       | Status               |
| ------------------------------------ | -------------------- |
| Terminais reais por agente           | Concluído            |
| Detecção de CLIs (Codex, Gemini, agy)| Concluído            |
| Provedor Google Antigravity CLI      | Concluído            |
| Seletor nativo e validação de pastas | Concluído            |
| Error Boundary e proteção visual     | Concluído            |
| Gerenciamento de tarefas local       | Concluído            |
| Histórico de atividades com filtro   | Concluído            |
| Sanitização de segredos em logs      | Concluído            |
| Modo Equipe dinâmico (3 provedores)  | Concluído            |
| Aprovação humana no fluxo equipe     | Concluído            |
| Painel Git permanente inteligente    | Concluído            |
| Central de Agentes (modelos/esforço) | Concluído            |
| Estados integrados no mundo 2D       | Concluído            |
| Empacotamento Desktop (Tauri/Elec)   | Pendente para futuro |
