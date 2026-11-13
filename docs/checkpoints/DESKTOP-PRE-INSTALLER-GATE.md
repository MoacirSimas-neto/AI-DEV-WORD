# AI Dev World — Desktop Pre-Installer Gate (Etapa 14.3.3)

**Data:** 2026-11-13  
**Branch:** `etapa-14-3-3-estabilidade-icone` (`cdf2a6a`)  
**Status:** **GO WITH CONDITIONS** (autorizado iniciar desenvolvimento da Etapa 14.4 — Instalador Windows; distribuição pública bloqueada até Etapa 14.5).

---

## 1. Funcionalidades Validadas
- Shell Tauri 2 (Windows) com System Tray, minimização controlada, restauração e `CloseConfirmModal`.
- Frontend React + Phaser (`game.loop.sleep()` / `wake()` integrado à visibilidade).
- Sidecar Node (`v24.19.0` x64) integrado com SQLite e `node-pty`.
- Autenticação desktop automática (`AIDW_DESKTOP_BOOTSTRAP_SECRET` → `/api/desktop-bootstrap` → código de pareamento de uso único → Bearer token em memória).
- Seleção nativa de pastas, Git Control, terminais e supervisão de processos com Windows Job Object (`KILL_ON_JOB_CLOSE`).

## 2. Testes Executados e Resultados Reais
- `npm.cmd run check`:
  - `server`: **293/293** testes passando (`noRealCli.ts`).
  - `web`: **77/77** testes passando (`vitest`).
  - `lint` (`oxlint`): **0 warnings, 0 erros** (66 arquivos, 116 regras).
- `cargo test --manifest-path src-tauri/Cargo.toml`: compilação e suíte Rust **exit code 0**.
- Identidade visual: ícone oficial atual preservado; candidatos experimentais mantidos apenas em `src-tauri/icons/candidates/` (não promovidos).

## 3. Segurança (Auth, Workspaces e Processos)
- **Autenticação**: segredo por instância, código de pareamento de uso único (TTL + limite de 5 tentativas / 429), validação de `Origin` e token Bearer em memória.
- **Workspaces**: `project-add` exige sessão WebSocket autenticada e valida caminho absoluto/diretório existente via `realpathSync.native()`.
- **Processos**: Windows Job Object garante encerramento da árvore de processos filhos em fechamento normal ou forçado.

## 4. Métricas e Ambiente
- Runtime Node observado: `v24.19.0` (`x64`), RSS base `38.5 MB`.
- Métricas completas de cold/warm start com WebView2 em execução interativa e ciclos prolongados de tray ficam pendentes de medição no pacote instalado (Etapa 14.4/14.5).

## 5. Riscos Residuais e Bloqueadores
### Pode iniciar desenvolvimento do instalador (Etapa 14.4)?
**Sim (GO WITH CONDITIONS):**
- Base de código, testes (370/370), lint (0 erros) e Job Object estão estáveis.
- Estratégia de sidecar atual (`scripts/prepare-sidecar.mjs` copiando `process.execPath`) funciona para build local, mas deve ser fixada/versionada de forma reproduzível na 14.4.

### Está seguro para distribuir o instalador aos usuários?
**Não (Bloqueadores para distribuição — Etapa 14.5):**
1. Assinatura digital do executável e do instalador Windows (evitar SmartScreen).
2. Teste de instalação/desinstalação e execução offline em VM Windows limpa (sem Node/Rust instalados).
3. Verificação final de empacotamento do sidecar Node + binários nativos (`node-pty`, SQLite) fora da máquina do desenvolvedor.
