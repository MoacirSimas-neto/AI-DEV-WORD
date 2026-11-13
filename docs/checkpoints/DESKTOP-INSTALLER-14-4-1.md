# AI Dev World — Etapa 14.4.1: Primeiro Instalador Windows (NSIS)

**Data:** 2026-11-13  
**Branch:** `etapa-14-4-1-windows-installer`  
**Instalador gerado:** `src-tauri/target/release/bundle/nsis/AI Dev World_0.1.0_x64-setup.exe` (**31.52 MiB**)

---

## 1. Arquitetura do Instalador
- **Empacotador:** Tauri 2 oficial (`npx.cmd tauri build --bundles nsis`).
- **Modo NSIS:** `installMode: "currentUser"` (instalação por usuário em `%LOCALAPPDATA%\Programs\AI Dev World\`, sem elevação de administrador, com atalho no Menu Iniciar e desinstalador padrão).
- **WebView2:** `webviewInstallMode: { type: "downloadBootstrapper" }` (mantém o `setup.exe` compacto em 31.52 MiB e baixa o runtime oficial da Microsoft apenas se ausente).

## 2. Estratégia Node & Integridade
- `scripts/prepare-sidecar.mjs` fixa exatamente **Node `24.19.0` (`x64`)** — compatível com `node:sqlite` nativo e ABI do `node-pty`.
- Calcula e valida **SHA-256** do binário copiado para `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`:
  - `sha256 = 3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`.
- **Nota de reprodutibilidade:** localmente valida o runtime exato `24.19.0 (x64)` via hash; em CI limpo, deve baixar o `node.exe` oficial (`nodejs.org/dist/v24.19.0/win-x64/`) conferindo `SHASUMS256.txt`.

## 3. Inventário Empacotado e Higiene
- **Incluído:** executável Tauri (`ai-dev-world.exe`), frontend `web/dist`, sidecar `binaries/node`, `server/src/**/*`, `server/package.json`, `shared/**/*`, `node_modules/node-pty/**/*`, `node_modules/ws/**/*`.
- **Excluído:** `.env`, chaves/tokens, bancos pessoais, `src-tauri/icons/candidates/`, testes e caches de dev.

## 4. Persistência de Dados
- Dados mutáveis (SQLite, preferências, histórico, estado dos agentes) ficam no diretório de dados do usuário (`%APPDATA%` / `%LOCALAPPDATA%`), nunca na pasta de instalação do programa, sendo preservados em atualizações/reinstalações.

## 5. Assinatura e Atualizações (Documentação)
- **Não habilitado nesta subetapa:** assinatura digital Authenticode, assinatura de pacotes de updater Tauri e auto-update permanecem bloqueados até a Etapa 14.5 (nenhum certificado fictício ou chave privada no repositório).

## 6. Testes e Limitações
- `npm.cmd run check`: **370/370** testes passando, **0 warnings / 0 erros** de lint.
- `cargo test`: **exit code 0**.
- `npx.cmd tauri build --bundles nsis`: **exit code 0** (`31.52 MiB`).
- **Limitação:** instalação real em **VM Windows limpa (sem Node/Rust/offline)** não foi executada neste host; pendente de validação manual antes de distribuição beta/pública.
