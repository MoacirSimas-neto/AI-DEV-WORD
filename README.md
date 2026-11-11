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

Neste piloto os papéis são organizacionais: cada personagem abre uma sessão
independente do seu CLI. A orquestração automática (modo equipe) ainda não existe.

## Requisitos

- Node.js 22.18 ou mais novo (testado no 24).
- [Codex CLI](https://github.com/openai/codex) e
  [Gemini CLI](https://github.com/google-gemini/gemini-cli) instalados e com
  login feito pelo próprio CLI (`codex login`, `gemini`). Um personagem cujo CLI
  não está instalado aparece como "Indisponível".
- Linux: o `node-pty` é compilado na instalação, então são necessários
  `build-essential` e Python, e o npm pode pedir para aprovar o script de
  instalação dele (`npm approve-scripts node-pty`). Ainda não testado em Linux.

## Como rodar

```
npm install
npm run dev
```

Abra http://localhost:5173, adicione a pasta de um projeto na barra do topo,
clique em um personagem e use "Iniciar sessão".

Mudanças no código do backend exigem reiniciar o `npm run dev` (o
`node --watch` é incompatível com o `node-pty` no Windows). O frontend recarrega sozinho.

Verificações: `npm run check` roda tipos, build, testes do backend e lint.

## O que significam os estados

| Estado          | Significado                                           | No mundo            |
| --------------- | ----------------------------------------------------- | ------------------- |
| Indisponível    | CLI não encontrado no PATH                            | parado, "zzz"       |
| Ocioso          | CLI pronto, sem sessão aberta                         | passeia pelo tapete |
| Aguardando você | sessão aberta, sem saída há mais de 1,5 s             | na mesa, "?"        |
| Trabalhando     | sessão aberta e o processo está escrevendo no terminal | na mesa, digitando  |

"Trabalhando" é uma heurística baseada na saída do processo, não uma leitura
do que o agente está pensando.

## Estrutura

```
shared/protocol.ts     contrato das mensagens WebSocket (só tipos)
server/src/
  cli/                 achar e executar os CLIs (inclui o tratamento de .cmd no Windows)
  agents/registry.ts   estado dos agentes: fonte da verdade
  terminal/            sessões de pseudo-terminal (node-pty), uma por agente
  projects/store.ts    projetos autorizados, em SQLite
  server.ts            HTTP + WebSocket
web/src/
  net/useServer.ts     conexão com o backend
  game/                cena Phaser: cenário, personagens, ponte React↔Phaser
  ui/                  barra de projetos, janela do agente, terminal (xterm.js)
```

Para entender o fluxo, leia nesta ordem: `shared/protocol.ts`,
`server/src/agents/registry.ts`, `server/src/terminal/manager.ts`.

## Segurança

- O backend escuta só em `127.0.0.1` e recusa requisições cuja origem não seja
  a página local (`localhost:5173`).
- O app não lê, guarda nem transmite credenciais. O login é sempre o do próprio
  CLI; do Codex só se consulta o código de saída de `codex login status`.
- Os CLIs são iniciados apenas dentro de pastas que você adicionou como projeto.
  Dentro da sessão, o que o agente pode fazer é governado pelas aprovações e
  pelo sandbox do próprio CLI.
- A lista de projetos fica em `~/.ai-dev-world/data.sqlite` (mude com
  `AIDW_DATA_DIR`). "Remover da lista" nunca apaga arquivos.

## Ainda não implementado

Tarefas e histórico, painel Git, modo equipe (Gemini planeja, Codex
desenvolve, Gemini revisa) e empacotamento como aplicativo desktop.
