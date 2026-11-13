# Security Baseline — AI Dev World

- **Auditorias:** Cloudflare `security-audit` `run-02` (4 achados) → Remediação `etapa-13-1`..`13-1-4` → Reauditoria `run-03` (`GO WITH CONDITIONS`).

## Estado dos 4 Achados Originais
| ID | Severidade | Estado | Mitigação |
|---|---|---|---|
| `FIND-001` | High | **Remediado com evidências** | Pareamento local (`POST /api/pair`), 5 tentativas, TTL 10m, uso único, cookie `HttpOnly; SameSite=Strict`, proxy Vite sem auto-auth |
| `FIND-002` | Medium | **Remediado com evidências** | `realpathSync(cwd)` + subida até ancestral existente em `GitService.assertInside` |
| `FIND-003` | Medium | **Remediado com evidências** | `asUntrusted(diff)` em `runner.ts` + `securityStops` e aprovações humanas no backend |
| `FIND-004` | Low | **Remediado com evidências** | Diretório privado `0o700` antes do `listen`, `chmodSync(0o600)`, cleanup no `close`; named pipes no Windows |

## Controles a Preservar no Desktop (Tauri 2)
1. **Autenticação:** Substituir pareamento manual por token de sessão gerado pelo processo Rust/Tauri e entregue via IPC seguro (nunca `VITE_*` no bundle).
2. **Loopback + Origin/Host:** Manter validação estrita no backend.
3. **Git & Prompts:** Manter `assertInside` (`realpathSync`), `previewPush` token e `asUntrusted` + `securityStops`.
4. **CSP:** Adicionar `Content-Security-Policy` estrita no Tauri WebView2.
