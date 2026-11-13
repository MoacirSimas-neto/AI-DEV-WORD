# AI Dev World — Etapa 14.6: Terminal Integrado ao Escritório

**Data:** 2026-11-13
**Branch:** `etapa-14-6-integrated-terminal` (a partir de `69ecf68`)

O dock inferior do escritório é um terminal real: um shell do sistema dentro de um PTY, na pasta do projeto ativo. Não há comandos pré-programados nem simulação.

---

## 1. Arquitetura

Nada de infraestrutura nova: o terminal pessoal usa o mesmo caminho dos terminais de agente.

| Peça | Arquivo | Papel |
|---|---|---|
| Sessões | `server/src/terminal/manager.ts` | `TerminalManager` já existente. Ids `user:<n>` são terminais pessoais; qualquer outro id precisa ser um agente registrado. |
| Processo | `server/src/terminal/spawnPty.ts` | `spawnShellPty` abre o shell com `node-pty`, pelo mesmo `spawnGuardedPty` dos agentes (ProcessSupervisor / Job Object). |
| Transporte | `server/src/server.ts` | Mesmo WebSocket autenticado e mesmas mensagens `term-open/input/resize/close`. Só uma mensagem nova: `term-sessions`. |
| Tela | `web/src/ui/TerminalDock.tsx` | Dock, abas, redimensionamento, `Ctrl+J`. |
| xterm | `web/src/ui/TerminalView.tsx` | Componente já existente, reutilizado sem cópia (ganhou só `autoStart`). |

Shell escolhido (nada é instalado): no Windows `pwsh`, depois `powershell`, depois `%ComSpec%`; no Linux `$SHELL`, depois `bash`, depois `/bin/sh`.

## 2. Integração frontend/backend

- O dock fica sempre montado em `App.tsx` e apenas some fora da aba Escritório: trocar de aba não perde abas nem sessões.
- O `TerminalView` de uma aba só é montado quando o usuário abre o dock naquela aba. Abrir o aplicativo não inicia nenhum shell.
- Recolher (`Ctrl+J` ou botão) esconde com CSS; o xterm e o PTY continuam.
- O backend é a fonte da lista de terminais pessoais (`term-sessions`, enviada ao conectar e a cada abertura/encerramento). Recarregar a página ou reconectar devolve as abas e o histórico (`replay`).
- Depois que um shell termina, ele não é reaberto sozinho: fica o botão "Iniciar sessão".
- O Phaser não é recriado ao abrir, recolher ou redimensionar o dock. O escritório usa `Scale.FIT` e se ajusta ao espaço que sobra.

## 3. Gestão de sessões

- Uma sessão por id, reaproveitada em `term-open` repetido (nenhum processo duplicado).
- Limite de 8 terminais pessoais abertos.
- Histórico de rolagem limitado a 200 mil caracteres por sessão.
- `term-close` mata a árvore de processos do shell. `closeAll()` roda no encerramento do backend.

## 4. Segurança

- O WebSocket exige origem permitida e sessão autenticada (inalterado). Sem sessão: 401.
- O cliente nunca envia caminho. A pasta inicial é o projeto ativo guardado no backend (pasta que o usuário registrou), passada como `cwd` do PTY. Não existe `cd` montado em texto.
- Nenhum comando é escrito no shell ao criar a sessão. Não há `git init`, commit, remoto ou push automáticos.
- Não foi criada API HTTP de execução de comandos.
- Ids fora de `user:<1-999>` não viram shell (`user:../x`, `user:1; calc` etc. caem em "Agente desconhecido").
- Terminal pessoal não altera o estado dos agentes, e nenhum caminho do orquestrador ou das missões escreve em sessão `user:<n>`: a única entrada é `term-input` do WebSocket autenticado.
- A saída continua passando pela redação de segredos existente (`liveRedaction`).

### Limitações de isolamento (leia antes de prometer algo ao usuário)

- **O terminal pessoal não é sandbox.** Ele roda com as permissões do usuário do sistema operacional. A pasta do projeto é só o diretório inicial: o usuário pode sair dela com `cd`.
- O app tem um único usuário local. Qualquer cliente com a sessão autenticada pode abrir, ler e escrever em qualquer terminal (pessoal ou de agente). Não há dono por conexão.
- Uma sessão aberta no projeto A continua viva e na pasta A se o projeto ativo mudar para B.

## 5. Integração com Git

- O Git Control não foi duplicado. Em pasta sem `.git` ele mostra "não é repositório"; o usuário digita `git init` no terminal.
- O Git Control já consulta o estado a cada 5 s (`useGitStatus`), então reflete o `git init` sem código novo. Não foi adicionado gatilho imediato.

## 6. Integração com agentes

- Agente com sessão real no backend (`agent.session`) ganha uma aba no dock, com o mesmo `TerminalView` do painel lateral. Nada é criado só para exibir a aba, e o dock não consegue iniciar sessão de agente.
- As regras de supervisão e aprovação não mudaram: a aba só mostra a sessão que já existe.
- Limitação: se a mesma sessão de agente estiver aberta no painel lateral e no dock ao mesmo tempo, os dois tamanhos de tela disputam o redimensionamento do PTY.

## 7. System Tray e encerramento

- Recolher o dock ou minimizar para a bandeja não encerra processos (a sessão pertence ao backend).
- Ao fechar a janela ou pedir "sair" pela bandeja, o app considera missões abertas **e** terminais vivos (lista vinda do backend + sessões de agente). Com algum ativo, abre a confirmação, que informa os terminais, exige um segundo clique e permite cancelar.
- A preferência salva "sempre encerrar" não pula a confirmação quando há terminal vivo.
- Os shells nascem sob o mesmo guardião dos agentes; o Job Object do Windows continua encerrando a árvore se o backend cair.

## 8. Diagnóstico das CLIs

Causa real do "erro ao consultar versão" de Codex, Gemini e Claude Code: o diagnóstico localizava o executável com `where`, que no Windows lista primeiro o shim **sem extensão** do npm (`...\npm\codex`, um script sh). Esse arquivo não é executável no Windows, então `--version` falhava. O Git não era afetado por ser `.exe`.

Correção: `environmentDiagnostics.ts` passou a usar o `resolveCommand` do próprio projeto, que respeita as extensões do Windows e acha `codex.cmd`. Sem `shell: true`. Resultado nesta máquina após a correção:

```
git    | ready      | git version 2.55.0.windows.3
codex  | needs_auth | codex-cli 0.167.2
gemini | needs_auth | 0.68.0
claude | needs_auth | 2.1.325 (Claude Code)
```

Só `--version` foi executado; nenhum login ou chamada de IA.

## 9. Performance

- A saída do terminal vai do WebSocket direto para o xterm; não passa por estado React, então digitar não re-renderiza o escritório.
- Um WebSocket só (o que já existia). Nenhum polling novo.
- Arrastar a divisória re-renderiza apenas o dock.
- **Não medido:** uso de RAM/CPU com o dock aberto no app desktop.
- **Não implementado:** controle de fluxo entre PTY e WebSocket. Um comando que despeja saída sem parar enfileira mensagens no socket local.

## 10. Testes

Automatizados (novos):

- `server/src/terminal/userShell.test.ts` — 9 testes: pasta inicial, nenhum comando inicial, entrada/saída, Ctrl+C, redimensionamento, isolamento entre abas, reaproveitamento, encerramento sem reinício, sem projeto, pasta inexistente, backend sem shell, falha de shell, ids inválidos, limite, agentes intocados. Um deles abre um **shell real** em pasta temporária, digita `git init` e confere pelo `GitService` que a pasta virou repositório.
- `server/src/server.test.ts` — terminal pessoal pelo WebSocket: lista do backend, eco, desconexão e reconexão com histórico, encerramento, id inválido.
- `web/src/ui/TerminalDock.test.tsx` — 8 testes: nada inicia ao abrir o app, recolher/restaurar sem recriar, `Ctrl+J` não interfere em campos de texto, sem projeto, múltiplas abas, abas vindas do backend, aba de agente só com sessão real, confirmação de saída com terminal ativo.

Validação ponta a ponta feita contra um backend real isolado (porta e pasta de dados próprias, PTY e PowerShell reais), por um cliente WebSocket: 18 verificações, todas OK — WebSocket sem sessão recusado (401), nenhum terminal ao conectar, recusa sem projeto, prompt na pasta do projeto, `git status` real, `git init` manual, Git Control passando a ver o repositório, segunda aba isolada, Ctrl+C, reconexão com histórico, encerramento sem sessões nem processos restantes.

## 11. Resultados

- `npm.cmd run check`: passou. 310 testes do backend e 87 da interface (397 no total, eram 379), typecheck e lint sem erro.
- `cargo test --manifest-path src-tauri/Cargo.toml`: compila e passa; o crate não tem testes (0 executados).
- `npx.cmd tauri build --bundles nsis`: **falhou, instalador não gerado.** Motivo: o aplicativo desktop estava aberto (`ai-dev-world.exe` e `node.exe` de `src-tauri\target\release`) e travava o `node.exe` que o build precisa sobrescrever ("Acesso negado"). Não é erro de código. Refazer com o aplicativo fechado.

## 12. Pendências

- **Validação visual no aplicativo desktop não foi feita** (sem navegador de automação disponível nesta máquina). Faltam, à mão: aparência do dock, arrastar a divisória, `Ctrl+J`, copiar/colar, comportamento do Phaser ao redimensionar, minimizar para a bandeja e restaurar, e a confirmação ao fechar com terminal ativo.
- Medir RAM/CPU com o dock aberto.
- Controle de fluxo PTY → WebSocket.
- Validação em VM limpa e pendências da auditoria de segurança continuam obrigatórias antes da beta.
