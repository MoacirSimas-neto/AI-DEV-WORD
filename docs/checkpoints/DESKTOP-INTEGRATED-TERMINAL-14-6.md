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
- A mesma sessão de agente pode estar no painel lateral e no dock ao mesmo tempo. Desde a 14.6.1 só um painel manda o tamanho do PTY (ver seção 13).

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
- Controle de fluxo PTY → WebSocket: implementado na 14.6.1 (ver seção 13).

## 10. Testes

Automatizados (novos):

- `server/src/terminal/userShell.test.ts` — 9 testes: pasta inicial, nenhum comando inicial, entrada/saída, Ctrl+C, redimensionamento, isolamento entre abas, reaproveitamento, encerramento sem reinício, sem projeto, pasta inexistente, backend sem shell, falha de shell, ids inválidos, limite, agentes intocados. Um deles abre um **shell real** em pasta temporária, digita `git init` e confere pelo `GitService` que a pasta virou repositório.
- `server/src/server.test.ts` — terminal pessoal pelo WebSocket: lista do backend, eco, desconexão e reconexão com histórico, encerramento, id inválido.
- `web/src/ui/TerminalDock.test.tsx` — 8 testes: nada inicia ao abrir o app, recolher/restaurar sem recriar, `Ctrl+J` não interfere em campos de texto, sem projeto, múltiplas abas, abas vindas do backend, aba de agente só com sessão real, confirmação de saída com terminal ativo.

Validação ponta a ponta feita contra um backend real isolado (porta e pasta de dados próprias, PTY e PowerShell reais), por um cliente WebSocket: 18 verificações, todas OK — WebSocket sem sessão recusado (401), nenhum terminal ao conectar, recusa sem projeto, prompt na pasta do projeto, `git status` real, `git init` manual, Git Control passando a ver o repositório, segunda aba isolada, Ctrl+C, reconexão com histórico, encerramento sem sessões nem processos restantes.

## 11. Resultados

- `npm.cmd run check`: passou. 310 testes do backend e 87 da interface (397 no total, eram 379), typecheck e lint sem erro.
- `cargo test --manifest-path src-tauri/Cargo.toml`: compila e passa; o crate não tem testes (0 executados).
- `npx.cmd tauri build --bundles nsis` (na 14.6): **falhou, instalador não gerado.** Refeito com sucesso na 14.6.1 (seção 13). Motivo: o aplicativo desktop estava aberto (`ai-dev-world.exe` e `node.exe` de `src-tauri\target\release`) e travava o `node.exe` que o build precisa sobrescrever ("Acesso negado"). Não é erro de código. Refazer com o aplicativo fechado.

## 12. Pendências (estado da 14.6; ver seção 13 para o que foi resolvido)

- **Validação visual no aplicativo desktop não foi feita** (sem navegador de automação disponível nesta máquina). Faltam, à mão: aparência do dock, arrastar a divisória, `Ctrl+J`, copiar/colar, comportamento do Phaser ao redimensionar, minimizar para a bandeja e restaurar, e a confirmação ao fechar com terminal ativo.
- Medir RAM/CPU com o dock aberto.
- Controle de fluxo PTY → WebSocket.
- Validação em VM limpa e pendências da auditoria de segurança continuam obrigatórias antes da beta.

---

## 13. Etapa 14.6.1 — build, validação visual e estabilização

**Data:** 2026-11-13. Partiu de `21be073`. Nenhuma funcionalidade nova.

### Build NSIS

- Antes do build: nenhum processo do AI Dev World em execução (verificado por caminho do executável e linha de comando). Nenhum processo foi encerrado.
- `npx.cmd tauri build --bundles nsis`: **passou** (a falha da 14.6 era só o app aberto travando o `node.exe`).
- Instalador: `src-tauri/target/release/bundle/nsis/AI Dev World_0.1.0_x64-setup.exe` (33.064.029 bytes, SHA-256 `4AA1A64A4897666EDDF42F33804A062140A5111D92FDB973D25034BA1EA1CC0B`), gerado depois das correções abaixo.
- Conferido no diretório de release: `node.exe` (sidecar), `_up_/server/src` com o código novo do terminal, `_up_/node_modules/node-pty` e `ws`, e o dock (`terminal-dock`) no JavaScript do frontend.
- **O instalador não foi executado nem instalado.** Não foi distribuído.

### Validação visual

Feita no **navegador** (Chrome), contra uma instância isolada do backend real (portas 4617/5273, pasta de dados e workspace temporários). **Não foi feita na janela do aplicativo desktop (WebView2)**: o app instalado usa os dados reais do proprietário.

| Item | Resultado |
|---|---|
| Terminal inferior abre | OK |
| PowerShell real responde | OK (Windows PowerShell 5.1) |
| Diretório inicial = workspace | OK |
| `git status` | OK |
| `git init` manual reconhecido pelo Git Control | OK (selo passou de "local" para "main"; painel Git mostra o repositório limpo) |
| Segunda aba independente | OK (PIDs de shell diferentes) |
| `Ctrl+J` abre e recolhe | OK, inclusive com o foco dentro do terminal |
| Redimensionar não reinicia o Phaser | OK (mesmo `<canvas>` antes e depois de arrastar a divisória e de recolher/abrir) |
| Alternar telas preserva sessões | OK. O escritório (Phaser) é remontado ao voltar de outra tela, como já era antes; os terminais não |
| Colar | OK pelo evento de colar do navegador (o texto chegou ao shell). Área de transferência real do sistema não testada |
| Copiar | **Não testado** |
| Minimizar para a bandeja preserva processos | **Não testado** (só existe no desktop) |
| Fechar com terminal ativo pede confirmação | **Não testado** no desktop (coberto só por teste automatizado do modal) |
| Enxurrada de saída (150 mil linhas) | Terminou, a tela continuou respondendo a cliques durante a saída |

Checklist que falta, para o proprietário, no app desktop: (1) instalar e abrir; (2) `Ctrl+J`, digitar um comando; (3) selecionar texto e copiar, colar com `Ctrl+V`; (4) minimizar para a bandeja, restaurar e conferir que o shell continua; (5) fechar a janela com terminal aberto e ver a confirmação; (6) repetir a (5) pela opção "sair" da bandeja.

### Problemas encontrados e correções

1. **Dock fora da tela (encontrado na validação visual).** Com um projeto ativo, o chat lateral esticava a página (1373 px numa janela de 861 px) e a barra do dock ficava abaixo da dobra. Correção: no escritório a tela passa a ter exatamente a altura da janela (`web/src/index.css`, uma regra). Conferido no navegador depois da correção.
2. **Controle de fluxo.** `TerminalManager` pausa a leitura do PTY quando a fila de envio do cliente mais atrasado passa de 1 MB (`bufferedAmount` do WebSocket) e retoma abaixo de 200 KB. Com o PTY pausado o próprio processo bloqueia ao escrever, então nada cresce sem limite no backend. Sem cliente conectado nada é pausado. Encerrar uma sessão pausada libera o PTY antes de matar. Arquivos: `server/src/terminal/manager.ts`, `server/src/server.ts`.
3. **Sessão compartilhada.** Em `TerminalView`, cada sessão tem um único painel "dono do tamanho": o último que abriu a sessão ou recebeu foco. Só ele envia `term-resize`; ao receber foco, o outro assume e envia o próprio tamanho. Se o dono sai da tela, o painel restante assume no próximo redimensionamento. Só frontend, sem mudança de protocolo.

### Testes

- `npm.cmd run check`: passou. 313 testes do backend e 89 da interface (402; eram 397), typecheck e lint sem erro.
- Novos: 3 em `server/src/terminal/userShell.test.ts` (pausa e retomada, encerrar pausado, **shell real** pausado para de emitir e ainda encerra) e 2 em `web/src/ui/TerminalView.test.tsx` (dono do tamanho; sessões diferentes não interferem).
- `cargo test --manifest-path src-tauri/Cargo.toml`: compila e passa; **a suíte Rust continua executando 0 testes** (o crate não tem testes).
- A saída dos testes do backend mostra `Error: AttachConsole failed` (processo auxiliar do node-pty ao matar um shell real). Já acontecia antes desta etapa com o teste de shell real da 14.6; nenhum teste falha por isso.

### Riscos residuais

- Validação no WebView2 real, bandeja, confirmação de saída, copiar e o próprio instalador: pendentes (checklist acima).
- O controle de fluxo protege o backend. Do lado da tela, o xterm tem fila própria e descarta saída acima de ~50 MB pendentes; controle ponta a ponta exigiria uma mensagem nova de confirmação no protocolo (mudança maior, não feita, precisa de aprovação).
- A pausa só foi exercitada por teste (fila simulada). Em uso local a fila do WebSocket dificilmente enche, então o caminho real de pausa não foi observado no app.
- Com dois painéis na mesma sessão, o que não é dono mostra o texto quebrado para o tamanho do outro (um PTY tem um tamanho só).
- Ao abrir o dock, o escritório não encolhe para caber: fica com rolagem própria. Cosmético, não alterado.
- Medição de RAM/CPU com o dock aberto, VM limpa e pendências da auditoria de segurança continuam em aberto.


---

## 14. Ajuste pontual — fechar abas pessoais

**Data:** 2026-11-13. O proprietário testou o terminal no app desktop e aprovou funcionamento e visual. Problema relatado: a primeira aba ("Meu Terminal") não podia ser fechada.

Mudança (só `web/src/ui/TerminalDock.tsx`; backend e protocolo intactos):

- Toda aba pessoal tem o X, inclusive a primeira e a última.
- Fechar envia o mesmo `term-close` de antes: o backend mata a árvore do shell e reenvia a lista de sessões.
- Sessão viva pede confirmação ("Encerrar terminal" / "Cancelar") numa faixa do próprio dock. Aba sem sessão viva fecha direto.
- Sem abas pessoais nem de agente: estado vazio com "+ Novo terminal". Nenhuma sessão é criada sozinha, nem por `Ctrl+J`.
- Abas de agente continuam sem X e sem alteração.

Limitações:

- O backend não sabe se há um comando rodando dentro do shell. Por isso a confirmação aparece para **toda** sessão viva, não só quando há comando ativo.
- Ao reiniciar o aplicativo (ou recarregar a página) sem nenhuma sessão viva, a aba "Meu Terminal" volta a aparecer como ponto de partida; o shell só nasce se o usuário abrir o dock. Reconexão sem recarga não traz abas fechadas de volta.

Testes: `npm.cmd run check` passou — 314 do backend e 94 da interface (408). Novos: 5 em `web/src/ui/TerminalDock.test.tsx` (primeira/única aba, confirmar e cancelar, primeira e última entre várias, reconexão, aba de agente) e 1 em `server/src/terminal/userShellClose.test.ts` (shell real com comando rodando: shell e processo filho morrem, a outra aba fica, a lista esvazia, nada renasce).

Validação visual: feita no navegador contra a instância isolada (confirmação, cancelar, encerrar, estado vazio, `Ctrl+J` sem criar sessão, "+ Novo terminal", fechar uma entre duas, recarga mostrando só a sessão viva). **Não validado no app desktop.**
