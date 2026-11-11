# AI Dev World

**Futuristic Command Center + Living Pixel Art Office** — Plataforma local de coordenação de agentes de IA onde cada personagem representa um agente real conectado aos CLIs oficiais (**Google Antigravity CLI (`agy`)**, **Codex CLI** e **Gemini CLI**). Roda 100% na sua máquina (Windows e Linux), sem depender de chaves de API pagas externas.

| Personagem | Papel               | CLI Padrão               | Identidade Visual no Escritório 2D       |
| ---------- | ------------------- | ------------------------ | ---------------------------------------- |
| Arquiteto  | Planeja a solução   | Antigravity CLI (`agy`)  | Óculos, blazer petróleo e gravata IA     |
| Dev        | Implementa o código | Codex CLI                | Headset menta, moletom verde e 2 telas   |
| QA         | Revisa e testa      | Antigravity CLI (`agy`)  | Visor analítico ciano e jaqueta âmbar    |
| Tutor      | Explica e ensina    | Gemini CLI               | Óculos de leitura e cardigã madeira      |

---

## Requisitos

- **Node.js 22.18+** (testado no Node 24).
- **CLIs instalados e autenticados** (pelo menos um):
  - [Google Antigravity CLI (`agy`)](https://antigravity.google)
  - [Codex CLI (`codex`)](https://github.com/openai/codex)
  - [Gemini CLI (`gemini`)](https://github.com/google-gemini/gemini-cli)
- **Git** instalado e disponível no `PATH`.
- **Linux**: `build-essential` e `python3` para compilação do `node-pty`.

---

## Como rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`.

Verificação completa (TypeScript, build Vite, testes automatizados e linter):
```bash
npm run check
```

---

## Arquitetura da Interface

### 1. Barra de Navegação Superior (5 Visões)
- **Home (Command Center):** Tela inicial com métricas operacionais reais (projetos, agentes configurados/em execução, missões ativas/concluídas, tarefas e aprovações pendentes), card de Missão em Destaque, Esquadrão de Agentes, Projetos Locais com estado Git e Linha do Tempo.
- **Escritório 2D (Living Agent Office):** Layout operacional em 3 colunas (Monitor de Missão à esquerda, Mundo 2D Phaser ao centro com **Modo Imersivo**, e Git Control à direita). A instância Phaser permanece montada ao alternar entre abas, preservando animações e sessões de terminal.
- **Projetos e Tarefas:** Gerenciamento completo de tarefas locais por projeto e disparo do Modo Equipe.
- **Histórico:** Registro persistente em SQLite com filtro por categoria e sanitização de credenciais (`redact`).
- **Central de Agentes:** Configuração individual de provedor (`antigravity`, `gemini`, `codex`), modelo e esforço de raciocínio (`default`, `low`, `medium`, `high`, `extra-high`), além de perfis rápidos (*Economia*, *Equilibrado*, *Máxima qualidade*).

### 2. Living Agent Office (Phaser 2D)
- **Zonas Funcionais:** Bancadas exclusivas por agente (Arquiteto com blueprint, Dev com monitor duplo, QA com checklist, Tutor junto à biblioteca), Mesa de Comando da Equipe, Quadro Kanban, Rack de Servidores com LEDs ativos, Cantinho do Café, Bebedouro e janelas panorâmicas noturnas.
- **Objetos Interativos com Highlight e Tooltip:** Clicar nas mesas abre o terminal do agente; clicar no Quadro Kanban abre Tarefas; na Biblioteca abre a Central de Agentes; no Rack de Servidores abre o Histórico; na Mesa de Reuniões foca o Monitor de Missão.
- **Movimentação Inteligente por Corredor:** Personagens utilizam waypoints no corredor principal para nunca atravessar mesas ou móveis, com animações dedicadas de caminhada (4 quadros), digitação (2 quadros), piscar de olhos e etiquetas pixeladas de estado (`PLAN`, `EXEC`, `QA REV`, `APROVAR`, `PRONTO`, `ESPERA`, `ERRO`, `OFF`).

### 3. Monitor de Missão e Progresso Verificável
- Exibe as 4 etapas operacionais: `1. Planejamento → 2. Desenvolvimento → 3. Revisão QA → 4. Entrega`.
- **Progresso 100% honesto e determinístico** (`shared/missionProgress.ts`): calculado exclusivamente por etapas concluídas (`0%` = 0/3, `33%` = 1/3, `67%` = 2/3, `100%` = 3/3). Nunca utiliza timers artificiais e nunca exibe 100% em missões interrompidas ou com falha.

### 4. Git Control: Git Local vs Repositório Remoto
- **Bloco Git Local:** Branch ativa, último commit (`git log -1`), contadores categorizados (`novos`, `modificados`, `removidos`, `conflitos`, `staged`), diff inline e **Commit Local** (grava alterações apenas na máquina local).
- **Bloco Repositório Remoto:** Estado explícito (`Configurado`, `Sem remote` ou `Estado remoto desconhecido`), nome do remote (`origin`), URL sanitizada sem credenciais (com opções Ver/Copiar), contadores `ahead/behind` com nota explicativa sobre referências locais e **Push Remoto** com confirmação em duas etapas via token de uso único.
- **Honestidade de Autoria:** Eventos originados pelo término do Dev no Modo Equipe identificam o agente; alterações externas detectadas por polling exibem o aviso neutro `"Novas alterações detectadas."`.

---

## Estrutura do Projeto

```
shared/
  protocol.ts             Contratos WebSocket, tipos de agentes, tarefas, missões e GitStatus
  missionProgress.ts      Cálculo determinístico de progresso por etapas verificadas (0/33/67/100%)
server/src/
  cli/                    Resolução segura de binários (agy, codex, gemini) e execução sem shell
  agents/                 Registro de estados em tempo real e persistência de modelos (SQLite)
  terminal/               Sessões PTY reais (node-pty) com injeção de modelo/esforço
  projects/               Validação e normalização canônica de caminhos Windows/Linux (SQLite)
  tasks/                  CRUD de tarefas e missões do Modo Equipe (SQLite)
  history/                Histórico persistente com sanitização de segredos (redact)
  team/                   Orquestrador do Modo Equipe (Arquiteto -> Aprovação -> Dev -> QA; reprovado volta ao Dev, até 3 tentativas)
  git/                    Serviço Git local/remoto com sanitização de URL e token de push
  server.ts               Servidor HTTP + WebSocket restrito a 127.0.0.1
web/src/
  game/                   Cenário Phaser 2D, sprites pixel art, atores e WorldBridge
  net/                    Hooks WebSocket e sincronização Git em tempo real
  ui/                     HomeView, MissionMonitor, GitPanel, AgentCenter, TaskPanel, HistoryPanel, AgentWindow
```
