# Etapa 15 — Equipe padrão, Central de Agentes e skills

**Status: NO-GO para entrega desktop.** A distinção entre lista vazia e ausência de snapshot tem cobertura automatizada. Faltam a validação visual, uma execução verde da suíte completa e um instalador novo.

## Central e autenticação

A interface inicializava os agentes com uma lista vazia e tratava dados ausentes como zero cadastros. Isso explica como a Central podia mostrar `Todas (0)` antes do snapshot. A causa específica da ocorrência no desktop pessoal continua desconhecida. A inspeção anterior relatada encontrou os quatro agentes ativos. Nesta etapa foram usados somente SQLite descartável e fixtures.

No web, o pareamento local antecede o WebSocket autenticado. No desktop, o frontend aguarda o sidecar e usa o token obtido pelo bootstrap. Após cada conexão, a Central aguarda um snapshot válido antes de mostrar os totais e liberar ações. Falha de pareamento, snapshot inválido, ausência de snapshot no prazo e falha do servidor têm estado de erro. A perda de uma conexão estabelecida mostra recuperação. A contagem zero exige uma lista vazia confirmada.

## Equipe e persistência

| ID | Responsabilidade | Provedor e modelo padrão |
| --- | --- | --- |
| `architect` | Arquiteto e Tech Lead, coordena e delega | Antigravity, `gemini-4-argon-high` |
| `dev` | Implementação e refatoração | Codex, `default` |
| `qa` | Revisão, testes e validação | Antigravity, `gemini-4-argon-high` |
| `tutor` | Explicação e aprendizado | Gemini, `gemini-3.5-flash` |

Os IDs e a autoridade de coordenação permanecem os mesmos. A Central diferencia cadastro, CLI ainda não verificado e sessão CLI ativa. A abertura do backend não inicia sondagens dos CLIs. A verificação manual do Gemini ainda pode fazer uma requisição mínima.

A migração de metadados roda ao promover o esquema legado. Na Etapa 15.1, a criação da tabela e dos registros iniciais passou a ocorrer na mesma transação. Uma tabela moderna existente e vazia permanece vazia. Reinícios não recriam registros ausentes nem regravam escolhas. A restauração individual altera apenas o agente padrão escolhido e mantém as atribuições de skills.

## Skills e conhecimento

A biblioteca usa `SkillStore` e os eventos WebSocket existentes. Criação e importação de Markdown/texto validam conteúdo, bloqueiam colisão de ID e salvam desativado. Controles globais e individuais permitem herdar, ativar, desativar e remover o ajuste. A biblioteca exibe origem, versão, instruções e incompatibilidade de modo nativo. Dependências e permissões declaradas em texto podem ser lidas nas instruções. Não há interpretação estruturada desses requisitos nem concessão de acesso ou execução de scripts pela importação. Ponytail e a adaptação local Caveman Lite estão nos recursos versionados, e registros já existentes mantêm o conteúdo. A escolha “Sem especialização” desliga a base de conhecimento do agente.

O NSIS anterior colocava o backend em `_up_/server`. O sidecar procurava `server` e podia cair no caminho do repositório do desenvolvedor. O resolver agora aceita o layout empacotado e só usa o caminho de desenvolvimento em debug. O manifesto inclui 15 arquivos explícitos de `knowledge/`, com SHA-256 conferido na árvore de build. Os documentos entram no prompt como referência externa subordinada ao escopo, permissões e aprovações.

## Verificação e riscos

- TypeScript, build web e lint passaram. Frontend: 97 testes passaram, incluindo estados da Central, reconexão e erro de pareamento simulado.
- Backend com limite de tempo: 290 passaram, 25 falharam, 2 cancelados. Houve `EACCES` em loopback, `EPERM` em temporários e falhas em cenários de Git e encerramento de processos. `npm.cmd run check` não ficou verde.
- Rust: 1 teste passou. O executável Windows compilou. O NSIS 3.13 não pôde ser baixado por falha de resolução de DNS (11001). A instalação limpa e a execução no Linux não foram verificadas.
- O navegador retornou `ERR_CONNECTION_TIMED_OUT` ao acessar o servidor isolado. Sem screenshots. A instância desktop pessoal e seus dados ficaram fora dos testes.
- Branch `etapa-15-default-team-agents`, base `668dcb8`. Alterações locais sem commit. `src-tauri/icons/candidates/` preservado.

## Etapa 15.1 — Comparação e correções

O baseline foi extraído de `668dcb8` para uma cópia isolada. Backend com o mesmo Node, dependências, modo simulado, limite de 30 s e saída forçada do executor. Baseline: 288 aprovados, 25 falhas e 2 cancelados. Etapa 15 antes das correções: 291 aprovados, 24 falhas e 2 cancelados. As 24 falhas coincidem pelo nome. O teste de fechamento do terminal, que falhou no relato anterior, falhou no baseline e passou na repetição da Etapa 15.

| Grupo na rodada de 25 falhas | Classificação e evidência |
| --- | --- |
| 18 testes HTTP/WebSocket | B/C. `EACCES` antes de chegar ao backend. Inclui snapshot, autenticação, reconexão e o teste Git via WebSocket. |
| 1 teste de Git | B/C. O push para um remoto local falhou no `sh.exe` do Git, em `NtCreateDirectoryObject`, código `0xC0000022`. |
| 1 limpeza do supervisor | B/C. `rmSync` recebeu `EPERM` no diretório temporário após os testes de processos. A causa específica do bloqueio do diretório não foi comprovada. |
| 3 testes de supervisor/missão | C. Timeout ao cancelar o CLI guardado e dois casos em que a fixture continuou escrevendo após cancelamento ou queda. Reproduzidos no baseline. A causa do encerramento incompleto não foi isolada. |
| 1 teste de fechamento do terminal | C/D. Falhou no baseline antes do fechamento, na confirmação de que shell e filho estavam ativos. Passou na repetição da Etapa 15. |
| 1 teste de autenticação WebSocket | A/B/C. A fixture ignorava erros de conexão e deixava a promessa pendente. Agora propaga o erro e continua exigindo HTTP 401 quando há resposta. |

Os dois cancelamentos do executor correspondem aos testes que atingiram 30 s: encerramento do CLI guardado e autenticação WebSocket. O primeiro ficou pendente ao aguardar o processo. O segundo foi corrigido na fixture para falhar imediatamente quando o transporte está bloqueado.

Regressões da Etapa 15 corrigidas: a inicialização repovoava tabela moderna vazia e a importação rejeitada apagava o rascunho. Uma leitura de arquivo atrasada também podia sobrepor edição mais recente. A cobertura verifica persistência do vazio, importação desativada e preservação do rascunho. O teste WebSocket de skills inclui colisão de ID normalizado e preservação do registro original, mas requer loopback funcional.

O NSIS esperado é o [ZIP oficial 3.13 do Tauri](https://github.com/tauri-apps/binary-releases/releases/tag/nsis-3.13). O [bundler oficial](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs) fixa SHA-1 `DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E` para esse ZIP e verifica o executável e o plugin no cache. Em Windows x64 autorizado, use Node 24.19.0, `npm ci` e `npm.cmd run tauri:build -- --bundles nsis`. Deixe o Tauri validar e preencher seu cache a partir da fonte oficial. Use um cache previamente validado pela mesma versão, se disponível. Verifique que o setup em `src-tauri/target/release/bundle/nsis/` foi gerado pela rodada atual.

Validação manual pendente em instância isolada: abrir a Central, verificar a equipe e os filtros, criar um agente temporário, atribuir uma skill, editar o agente, reconectar e verificar a persistência. Interromper a conexão e confirmar o estado de erro ou recuperação. Repetir em instalação limpa, com SQLite descartável. O navegador isolado voltou a dar timeout em loopback.

Na rodada de estabilização, o backend com limite de tempo registrou 292 aprovações, 25 falhas e 1 cancelamento. A autenticação agora reporta `EACCES` diretamente. O cancelamento restante é do teste de encerramento do CLI guardado. Após mover a regra de colisão para o armazenamento de skills, os 28 testes focados passaram, incluindo a nova regressão de persistência após colisão. TypeScript, build web, lint, 98 testes de frontend e 1 teste Rust passaram. O `npm.cmd run check` sem limite ficou pendente no backend e foi interrompido.

O executável Windows recompilou. A árvore de build contém os 15 documentos com SHA-256 idêntico ao da origem. O NSIS voltou a falhar com DNS 11001 e não gerou setup novo. Não foi possível confirmar um cache oficial reutilizável nesta sessão. Sem evidência visual ou execução desktop instalada. Status final: **NO-GO para entrega**.

Proposta de commits locais após validação: (1) persistência e Central de Agentes, com regressões de snapshot e autenticação; (2) biblioteca e persistência de skills; (3) recursos desktop, sidecar e checkpoint.
