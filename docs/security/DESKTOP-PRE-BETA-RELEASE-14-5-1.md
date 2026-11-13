# AI Dev World — Pré-Liberação Beta (Etapa 14.5.1)

**Data:** 2026-11-13  
**Branch:** `etapa-14-5-desktop-security-gauntlet`  
**Veredicto:** **GO WITH CONDITIONS** (código e suíte automatizada aprovados; distribuição beta bloqueada até assinatura digital e validação em VM Windows limpa).

---

## 1. Separação Explícita de Cobertura

### Segurança Verificada (Automatizada)
- Autenticação desktop (`AIDW_DESKTOP_BOOTSTRAP_SECRET`, Bearer em memória, `Origin` check).
- Consentimento nativo (`confirm_tool_install` → `POST /api/setup/consent` com `x-aidw-desktop-secret` → `consentNonce` 60s, uso único, escopo por `toolId`).
- Catálogo fixo (`TOOL_SETUP_CATALOG`) sem `shell: true` genérico.
- Validação de caminhos de workspace (`projects.add` rejeita caminhos relativos e inexistentes; `realpathSync.native()`).

### Segurança Ainda Não Verificada em Runtime Real
- Comportamento de symlinks/junctions em `project-add` sob ataque ativo pós-validação (TOCTOU).
- Execução real de `winget` / `npm` em máquina limpa sem ferramentas de desenvolvimento.

### Testado Apenas com Mocks vs Testado em App Instalado
- **Mocks/Fixtures:** `npm.cmd run check` (**379/379**), `cargo test` (**exit code 0**).
- **App Instalado em VM Limpa:** **0 testes executados** (`WindowsSandbox` indisponível neste host; ambiente pessoal preservado).

---

## 2. Procedimento Manual Reproduzível (VM Windows Limpa)
1. Copiar `src-tauri/target/release/bundle/nsis/AI Dev World_0.1.0_x64-setup.exe` (**31.53 MiB**) para VM Windows 10/11 limpa (sem Node, Rust, Git ou VS Code).
2. Executar instalação `currentUser`, abrir pelo Menu Iniciar e confirmar WebView2 + SQLite + autenticação automática.
3. Percorrer `FirstRunWizard`, testar diálogo nativo `confirm_tool_install` (Cancelar e Confirmar), entrar no escritório Phaser, minimizar para System Tray, encerrar e desinstalar preservando `%APPDATA%`.

---

## 3. Assinatura Digital & Bloqueadores para Beta
- **Assinatura digital:** não configurada (sem certificado Authenticode; SmartScreen alertará usuários).
- **Bloqueadores:** (1) Assinatura digital Authenticode, (2) Execução do checklist acima em VM Windows limpa.
