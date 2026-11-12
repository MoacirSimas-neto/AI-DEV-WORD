# AI Dev World

Aplicativo **local** para coordenar agentes de IA de programação num projeto da sua máquina. Cada agente é um personagem num escritório 2D (Phaser) e executa um **CLI oficial já instalado e autenticado por você**. O app não usa chaves de API próprias: ele chama os CLIs.

> **Estado:** protótipo em desenvolvimento ativo, para uso pessoal e de desenvolvimento. **Não está pronto para distribuição pública** (sem instalador, sem assinatura de código, sem auditoria ofensiva completa).

---

## Integrações realmente disponíveis

| CLI | Comando | Uso no app |
| --- | --- | --- |
| Codex CLI | `codex` | Execução headless (`codex exec`) e terminal interativo |
| Gemini CLI | `gemini` | Execução headless e terminal interativo |
| Google Antigravity CLI | `agy` | Execução headless (`agy -p`) e terminal interativo |

**Claude Code não é um provedor integrado.** Nenhum outro provedor é suportado hoje.

Agentes padrão: **Arquiteto** (Tech Lead / planejamento), **Dev** (implementação), **QA** (revisão) e **Tutor**. O provedor, o modelo e o esforço de cada um são configurados na Central de Agentes. Também é possível criar agentes personalizados com especializações.

---

## Funcionalidades

- **Escritório 2D (Phaser):** agentes com estado ao vivo (planejando, executando, revisando, aguardando aprovação), dock de agentes e objetos clicáveis que levam às telas.
- **Terminais:** sessão PTY real do CLI de cada agente, sempre na pasta do projeto ativo.
- **Projetos e tarefas:** pastas autorizadas por você, com tarefas por projeto.
- **Missões em dois modos** (veja abaixo): clássico e dinâmico.
- **Skills e memória:** skills (instruções reutilizáveis) por agente e memória do projeto/equipe. O que entra em cada prompt fica registrado na missão.
- **Observabilidade:** trilha de eventos por missão (início/fim de CLI, delegação, propostas, decisões, arquivos alterados), com a natureza de cada evidência: observado pelo sistema, declarado pelo agente ou incluído no contexto.
- **Git Control:** estado do repositório, diff, commit e push com pré-visualização.
- **Recuperação de missões** após fechamento ou queda do app.

## Chat com o Tech Lead (entrada principal)

Ao abrir o app, a aba **Chat** mostra as conversas do projeto ativo. Você pode conversar com o Tech Lead, ou com outro agente planejador ativo, sobre ideias, requisitos, arquitetura e planejamento.

- **Conversar não executa nada.** O agente roda com o papel de planejamento, sem permissão de escrita e sob o supervisor de processos. Nenhuma resposta vira proposta, aprovação ou missão. Para implementar, use **Tarefas** (modos clássico e dinâmico).
- As conversas ficam no SQLite, separadas por projeto: uma conversa não é vista nem usada a partir de outro projeto. Elas podem ser renomeadas e excluídas (com confirmação).
- **Contexto limitado:** cada resposta recebe só as mensagens mais recentes (até 20 e 16 mil caracteres). Quando mensagens antigas ficam de fora, a resposta avisa.
- Uma resposta por vez no app. **Interromper** encerra o processo do CLI e guarda o texto parcial. Se o app fechar no meio, a resposta fica como interrompida e nada é relançado.
- Sem CLI disponível, as conversas continuam consultáveis.
- O texto mostrado e o gravado passam pela remoção de segredos. A interface renderiza Markdown sem HTML: links só abrem se forem `http(s)`.
- Se arquivos mudarem durante uma resposta, ela é marcada com erro e aviso. Nada é desfeito.

## Modos de missão

### Clássico
Uma equipe fixa trabalha em sequência: **planejamento → aprovação humana do plano → desenvolvimento → revisão do QA**. Quando o QA reprova, o trabalho volta ao Dev até um limite de tentativas.

### Dinâmico (Tech Lead)
O Tech Lead propõe a equipe e os passos (análise, implementação, revisão, verificação) num formato estruturado que o **backend valida** (formato, revisão vigente, membros, permissões por categoria, dependências e limites). Nada roda sem a sua decisão:

- **Aprovar**, **rejeitar** ou **pedir ajustes** em cada proposta. A decisão vale só para a revisão que você viu.
- Quando um passo falha, é reprovado ou fica bloqueado, o Tech Lead é consultado de novo e a nova proposta também aguarda você.
- Limites por missão: passos, turnos do Tech Lead, mudanças de equipe, retrabalho e chamadas por agente.

Pode consumir mais chamadas aos CLIs que o modo clássico.

## Recuperação

Se o app fechar durante uma missão dinâmica, ela fica **parada aguardando decisão**: nenhum CLI é relançado sozinho. O painel de recuperação mostra os passos interrompidos e as alterações no Git. Ele também oferece continuar, reexecutar um passo, pedir replanejamento, encerrar ou cancelar.

Cada arquivo registrado pela missão guarda uma impressão SHA-256. Se ele mudar por fora, ou se a missão for antiga e não tiver impressão, a próxima escrita só acontece depois da sua confirmação. **A confirmação vale exatamente para a lista exibida:** se surgir outra alteração depois disso, o backend recusa e pede uma nova confirmação. Nada é desfeito no repositório.

Missões clássicas interrompidas são marcadas como falhas, e a tarefa volta para "a fazer".

---

## Requisitos

- **Node.js 22.18+** (desenvolvido no Node 24).
- **Git** no `PATH`.
- Pelo menos um dos CLIs acima instalado e autenticado.
- Windows ou Linux. No Linux, `build-essential` e `python3` (compilação do `node-pty`).

## Instalação e desenvolvimento

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. O backend escuta só em `127.0.0.1:4517` e aceita apenas a origem da interface local.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `AIDW_DATA_DIR` | `~/.ai-dev-world` | Pasta do banco SQLite e da trava de instância |
| `AIDW_PORT` | `4517` | Porta do backend |
| `AIDW_WEB_PORT` | `5173` | Porta da interface (faz parte das origens aceitas) |

Para uma instância isolada (testes, validação), use outra `AIDW_DATA_DIR` e outras portas.

### Configuração dos CLIs

1. Instale e faça login em cada CLI pelo terminal, da forma oficial de cada um.
2. No app, a Central de Agentes mostra se o CLI foi encontrado e se há login. **A verificação de login do Gemini executa um prompt mínimo e gasta 1 requisição.**
3. Escolha provedor, modelo e esforço por agente.

### Dados locais e instância única

- Banco: `data.sqlite` em `AIDW_DATA_DIR`, em modo **WAL** com `busy_timeout` de 5 s. Os arquivos `-wal` e `-shm` ao lado fazem parte do banco: para fazer backup, feche o app e copie os três.
- **Um backend por pasta de dados:** um segundo backend apontando para a mesma pasta é recusado com uma mensagem clara, antes de abrir o banco. A trava (`instance.lock`) é liberada pelo sistema operacional se o processo morrer, então não é preciso apagar nada depois de uma queda.

---

## Testes

```bash
npm run check   # typecheck do backend, build da interface, testes (backend + frontend) e lint
npm test        # só os testes
npm test -w web # só os testes de componentes (Vitest + Testing Library, jsdom)
```

O backend usa `node --test`. **Os testes nunca chamam CLIs reais:** `npm test` força o modo simulado (`test/noRealCli.ts`), e CLI real só com `AIDW_ALLOW_REAL_CLI=1` explícito e configuração própria. Os testes de concorrência do SQLite e do supervisor de processos usam bancos, pastas e processos descartáveis. O frontend testa o comportamento visível e as mensagens enviadas ao backend. O Phaser é simulado nos testes, porque WebGL não roda em jsdom.

---

### Validação com CLIs simulados

Para rodar o app inteiro sem gastar cota, use `AIDW_CLI_MODE=simulated` com `AIDW_SIMULATED_CLI_DIR=<pasta absoluta>`. A pasta precisa ter `codex`, `gemini` e `agy` (no Windows, `.cmd`), cada um contendo o texto `AIDW-SIMULATED-CLI`. Nesse modo o backend **não consulta o PATH**: se faltar um simulado, ele não inicia. Ao iniciar, o backend registra qual executável cada CLI usa.

## Permissões e segurança

- **Os CLIs agem no seu projeto com as permissões que você configurou neles.** No modo clássico e nos passos de implementação, o Dev roda com escrita: Codex com `--sandbox workspace-write`, Gemini com `--approval-mode auto_edit` e Antigravity com `--mode accept-edits`. Os passos de leitura usam modo somente leitura quando o CLI oferece essa opção. **Trabalhe num repositório Git com commit em dia.**
- Os agentes só são iniciados dentro da pasta do projeto ativo. Shims `.cmd` no Windows só recebem argumentos simples (sem metacaracteres de shell).
- O texto produzido pelos modelos é tratado como dado não confiável. Propostas fora do formato ou das regras são recusadas por inteiro. **Isso não elimina prompt injection:** um conteúdo malicioso no projeto ainda pode influenciar o que o CLI faz dentro das permissões dele.
- **Escrita sem permissão é detectada pelo backend:** antes de cada etapa sem escrita, o backend registra a impressão SHA-256 dos arquivos alterados no Git e confere depois. Se algo mudou, a missão para, com evento observado, e nada é desfeito. Essa verificação não depende de o CLI obedecer ao prompt. Arquivos ignorados pelo `.gitignore` não entram na conferência.
- Credenciais: o app não lê nem guarda tokens dos CLIs. A **remoção de segredos é baseada em padrões** (chaves conhecidas, JWT, `senha=`, `*_API_KEY=`, URLs com credencial, chaves privadas) e vale para histórico, eventos, memória, mensagens de erro, diff encaminhado entre agentes e **saída ao vivo** (terminal e missões). Na saída ao vivo, ela funciona mesmo com o segredo partido entre pedaços ou entremeado de códigos ANSI. **Segredos sem formato reconhecível não são detectados.** Num fluxo muito lento, os primeiros caracteres de um segredo podem aparecer antes da detecção. Não cole segredos em tarefas.
- **Processos locais do mesmo usuário** (inclusive um CLI com acesso a shell e sem sandbox) conseguem falar com o backend em `127.0.0.1`, forjando o cabeçalho `Origin`, e assim poderiam aprovar propostas. A verificação de origem só barra páginas de outros sites. Com o app rodando como o mesmo usuário, não há como esconder um segredo desse processo. Use os CLIs com as proteções deles (sandbox do Codex, aprovação de comandos).

## Limitações conhecidas

- Todo CLI (missão ou terminal) roda sob um **guardião** ligado ao backend por um canal local. Se o backend cair, mesmo à força, o canal fecha e o guardião encerra a árvore de processos do CLI (medido: nenhum processo restante 1,5 s depois). O guardião só encerra o que ele mesmo iniciou. **Não coberto:** o guardião ser encerrado sozinho, e um CLI que se desligue da própria árvore (daemon). A garantia completa depende de um supervisor no app desktop (Job Object no Windows).
- Backends de versões anteriores à trava de instância não a respeitam. Não rode versões antigas e novas na mesma pasta de dados.
- O escritório Phaser é **desmontado ao trocar de aba** e remontado em cerca de 0,1 s ao voltar. Isso foi decidido na Etapa 11.2 depois de comparar com a opção de mantê-lo montado, oculto e com o loop suspenso. Medidas no Chromium: CPU oculto ~0% nas duas; troca de aba 94 ms contra 31 ms; memória do navegador fora do escritório 371–416 MB contra 441 MB. Mantê-lo montado também manteria vivos o painel lateral e o terminal. A memória em repouso pesou mais que os 60 ms de troca.
- Os CLIs não informam custo nem tokens. Os limites contam chamadas e passos.
- Sem empacotamento desktop ainda.
