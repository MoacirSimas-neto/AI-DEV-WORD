# Instalador Windows e Assistente de Primeira Execução (Etapa 14.0)

## 1. Instalador Windows (`RECOMENDAÇÃO TÉCNICA` — pendente aprovação)
- **Recomendação:** **NSIS** (por usuário, `perUser`, sem exigir administrador) para a primeira beta fechada.
- **Alternativa:** MSI (melhor para deploy corporativo/GPO, mas exige privilégios elevados por padrão e gera mais atrito para amigos na beta).
- **WebView2:** Bootstrapper/offline check automático pelo Tauri.
- **Dados:** SQLite e configs permanecem em `%USERPROFILE%\.ai-dev-world` (preservados em atualizações/desinstalação opcional).

## 2. Assistente de Primeira Execução (Onboarding Guiado)
Fluxo retomável sem exigir terminal:
1. Verificar serviços locais (sidecar + SQLite).
2. Detectar `git`, `codex`, `gemini`, `claude`/`agy` com estados: `Instalado`, `Ausente`, `Incompatível`, `Requer autenticação`, `Instalando`, `Pronto`, `Falha`, `Ignorado`.
3. Oferecer links/comandos guiados de instalação oficial **somente com consentimento explícito** (nunca instalação silenciosa).
4. Orientar login nas contas do usuário e seleção de pasta de projeto.
5. Abrir o Escritório 2D mesmo se alguma CLI estiver ausente.
