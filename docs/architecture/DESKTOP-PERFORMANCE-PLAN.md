# Plano de Desempenho Desktop — AI Dev World (Etapa 14.0)

> **Nota:** Evidências complementares multi-resolução da Etapa 12.4.4 seguem pendentes; este plano define métricas observáveis para a Etapa 14.

## Métricas a Medir (Web atual vs. Tauri Desktop)
- **Inicialização:** Tempo até `GET /api/health` + abertura do Escritório 2D.
- **Memória:** RAM do WebView2, processo Rust/Tauri, sidecar Node e processos filhos (PTY/CLIs).
- **Renderização:** FPS aproximado do Phaser 2D e uso de GPU em repouso vs. missão ativa.
- **Bundle:** `PhaserGame` (~1.2 MB minificado / ~327 KB gzip) já usa lazy loading; monitorar tamanho final do instalador NSIS com runtime Node + `node-pty`.
- **Ciclo de vida:** Contagem de processos após encerrar a janela (0 processos órfãos).
