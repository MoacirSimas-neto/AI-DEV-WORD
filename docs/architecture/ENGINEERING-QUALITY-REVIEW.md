# Engineering Quality Review — AI Dev World Desktop (Etapa 14.0)

> **Status:** Revisão crítica consultiva (`PENDENTE DE APROVAÇÃO HUMANA`). Nenhuma implementação iniciada.

## 1. Equilíbrio dos 4 Pilares (Desempenho × Segurança × Estabilidade × Manutenção)
- **Tauri 2 + Híbrido (IPC bootstrap + WS local autenticado):** Melhor equilíbrio. Evita reescrever streaming de PTY/Phaser/Chat/Missões em IPC puro, mantendo superfície de ataque mínima na WebView (`get_session_config` único comando IPC).
- **Runtime Node empacotado (`DECISÃO PROVISÓRIA`):** Preserva `node-pty` e `node:sqlite` sem risco de quebra de addon nativo no Node SEA. Requer PoC na Etapa 14.2 comparando tamanho, cold start e carregamento de `.node`.
- **Autenticação Desktop:** Token efêmero gerado pelo Rust, passado ao sidecar via env privado (`AIDW_AUTH_TOKEN`) e à WebView via IPC `get_session_config()`. *Ressalva:* se a WebView sofrer XSS, o JS teria acesso ao token retornado por IPC — mitigado por CSP estrita (`script-src 'self'`) e ausência de `dangerouslySetInnerHTML`.
- **Instalador NSIS (`perUser`) + Updater assinado:** Instalação sem admin para beta fechada; assinatura de código Windows obrigatória antes de distribuir fora da máquina do proprietário.

## 2. Otimização do Phaser 2D & Agentes
- **Phaser 2D:** Pausar/reduzir loop de renderização (`game.loop.sleep()` / `visibilitychange`) quando o usuário estiver em abas secundárias (`Git`, `Memória`, `Observabilidade`) ou com a janela minimizada, sem desconectar o WebSocket nem perder atualizações de estado dos agentes.
- **Agentes / CLIs:** Inicialização sob demanda, limite configurável de concorrência, buffers de terminal com teto de linhas, timeouts e encerramento garantido da árvore de processos via `ProcessSupervisor` + cleanup do sidecar no exit do Rust.

## 3. Metas Exploratórias de Desempenho (a validar na 14.1–14.3)
- **Janela aberta:** ≤ 3s (warm) | **Escritório interativo:** ≤ 5s | **Phaser:** 60 FPS ativo, ~0% GPU/CPU quando oculto/minimizado | **CPU repouso:** < 3% | **RAM sem CLIs:** < 500 MB (WebView2 + Rust + Node) | **Encerramento:** ≤ 3s com **0 processos órfãos**.
- *Condição:* Evidências multi-resolução da Etapa 12.4.4 seguem pendentes e serão medidas junto à PoC da 14.1.

## 4. Estabilidade & Recuperação
- **Sidecar crash:** Rust detecta saída inesperada, exibe estado claro na UI e permite reinício controlado (nunca reexecuta missões/ações destrutivas automaticamente sem aprovação humana).
- **SQLite:** Manter transações atômicas e migrações idempotentes; backup antes de migrações de versão na beta.

## 5. Provas de Conceito (PoCs) Obrigatórias
1. **PoC 14.1:** Shell Tauri 2 abrindo `web/dist` com Phaser 2D a 60 FPS no WebView2.
2. **PoC 14.2:** Runtime Node empacotado carregando `node-pty` e `node:sqlite` no Windows sem Node global + zero órfãos no exit.
3. **PoC 14.3:** IPC `get_session_config` + WS autenticado + CSP estrita bloqueando scripts inline/externos.
