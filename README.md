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

O backend usa `node --test`. Os testes de concorrência do SQLite usam bancos descartáveis e processos filhos reais. O frontend testa o comportamento visível e as mensagens enviadas ao backend. O Phaser é simulado nos testes, porque WebGL não roda em jsdom.

---

## Permissões e segurança

- **Os CLIs agem no seu projeto com as permissões que você configurou neles.** No modo clássico e nos passos de implementação, o Dev roda com escrita: Codex com `--sandbox workspace-write`, Gemini com `--approval-mode auto_edit` e Antigravity com `--mode accept-edits`. Os passos de leitura usam modo somente leitura quando o CLI oferece essa opção. **Trabalhe num repositório Git com commit em dia.**
- Os agentes só são iniciados dentro da pasta do projeto ativo. Shims `.cmd` no Windows só recebem argumentos simples (sem metacaracteres de shell).
- O texto produzido pelos modelos é tratado como dado não confiável. Propostas fora do formato ou das regras são recusadas por inteiro. **Isso não elimina prompt injection:** um conteúdo malicioso no projeto ainda pode influenciar o que o CLI faz dentro das permissões dele.
- Credenciais: o app não lê nem guarda tokens dos CLIs. Textos gravados (histórico, eventos, memória) passam por uma **remoção de segredos baseada em padrões** (chaves conhecidas, JWT, `senha=`, `*_API_KEY=`, URLs com credencial). **Ela não detecta segredos sem formato reconhecível.** Não cole segredos em tarefas.
- A saída ao vivo dos terminais e dos CLIs chega à interface sem filtro.

## Limitações conhecidas

- Se o backend for **encerrado à força** (queda, `kill`, Gerenciador de Tarefas), o processo do CLI em execução **não é encerrado junto no Windows**: ele continua até terminar sozinho e pode alterar arquivos depois disso. A recuperação detecta essas alterações e pede confirmação. O encerramento normal (Ctrl+C) encerra os CLIs.
- Backends de versões anteriores à trava de instância não a respeitam. Não rode versões antigas e novas na mesma pasta de dados.
- O escritório Phaser é **desmontado ao trocar de aba** e remontado em cerca de 0,1 s ao voltar. Isso foi decidido na Etapa 11.2 depois de comparar com a opção de mantê-lo montado, oculto e com o loop suspenso. Medidas no Chromium: CPU oculto ~0% nas duas; troca de aba 94 ms contra 31 ms; memória do navegador fora do escritório 371–416 MB contra 441 MB. Mantê-lo montado também manteria vivos o painel lateral e o terminal. A memória em repouso pesou mais que os 60 ms de troca.
- Os CLIs não informam custo nem tokens. Os limites contam chamadas e passos.
- Sem empacotamento desktop ainda.
