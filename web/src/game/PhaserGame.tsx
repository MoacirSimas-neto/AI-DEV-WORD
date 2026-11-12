import Phaser from 'phaser'
import { useEffect, useRef, useState } from 'react'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { computeOfficePlacement, FONT, MAX_VISIBLE_SPECIALISTS, WORLD } from './officeLayout.ts'
import { OfficeScene } from './OfficeScene.ts'
import { trackPhaserGlobals } from './phaserLifecycle.ts'
import { type WorldAction, WorldBridge } from './WorldBridge.ts'

interface Props {
  agents: AgentInfo[]
  selectedId: string | null
  /** Precisa ser estável (ex.: useCallback), pois recria o jogo se mudar. */
  onSelect: (id: string) => void
  onAction?: (action: WorldAction) => void
  /** Participantes da missão dinâmica aberta. */
  team?: string[]
  /** Último encaminhamento real de contexto entre dois agentes. */
  forward?: { id: number; from: string; to: string } | null
}

/** Monta o jogo Phaser uma vez e repassa as props para a cena pela WorldBridge. */
export function PhaserGame({ agents, selectedId, onSelect, onAction, team, forward }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<WorldBridge | null>(null)
  const onSelectRef = useRef(onSelect)
  const onActionRef = useRef(onAction)
  const [specialistPage, setSpecialistPage] = useState(0)

  const placement = computeOfficePlacement(agents, specialistPage)

  useEffect(() => {
    onSelectRef.current = onSelect
    onActionRef.current = onAction
  })

  useEffect(() => {
    const bridge = new WorldBridge()
    bridge.agents = agents
    bridge.selectedId = selectedId
    bridge.specialistPage = placement.page
    bridge.team = team ?? []
    bridge.on('select', (id: string) => onSelectRef.current?.(id))
    bridge.on('action', (action: WorldAction) => onActionRef.current?.(action))
    bridgeRef.current = bridge
    let game: Phaser.Game | undefined
    let disposed = false
    const globals = trackPhaserGlobals()

    void document.fonts
      .load(`14px ${FONT}`)
      .catch(() => undefined)
      .then(() => {
        if (disposed) return
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host.current!,
          width: WORLD.width,
          height: WORLD.height,
          antialias: true,
          antialiasGL: true,
          roundPixels: false,
          backgroundColor: '#0f172a',
          // O escritório não tem som. Sem isto cada montagem criava um AudioContext, e desmontar
          // (trocar de aba) podia lançar "InvalidStateError: AudioContext is closed" (validação 10.6).
          audio: { noAudio: true },
          scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
          scene: new OfficeScene(bridge),
          callbacks: { postBoot: globals.postBoot },
        })
      })

    return () => {
      disposed = true
      bridgeRef.current = null
      bridge.removeAllListeners()
      game?.destroy(true)
      globals.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bridgeRef.current?.setAgents(agents)
  }, [agents])

  useEffect(() => {
    bridgeRef.current?.setSelected(selectedId)
  }, [selectedId])

  // Só muda a cena quando a composição muda de fato (a lista chega como array novo a cada render).
  const teamKey = (team ?? []).join(',')
  useEffect(() => {
    bridgeRef.current?.setTeam(teamKey ? teamKey.split(',') : [])
  }, [teamKey])

  useEffect(() => {
    if (forward) bridgeRef.current?.pulse(forward.from, forward.to)
  }, [forward])

  useEffect(() => {
    bridgeRef.current?.setSpecialistPage(placement.page)
  }, [placement.page])

  return (
    <div className="world-wrapper">
      {placement.totalSpecialists > MAX_VISIBLE_SPECIALISTS && (
        <div className="world-pagination-bar">
          <span>
            Ala de Especialistas: página {placement.page + 1} de {placement.totalPages} ({placement.totalSpecialists}{' '}
            personalizados ativos)
          </span>
          <div className="world-pagination-actions">
            <button
              type="button"
              className="btn-quiet btn-xs"
              disabled={placement.page === 0}
              onClick={() => setSpecialistPage((p) => Math.max(0, p - 1))}
            >
              ◀ Ala Anterior
            </button>
            <button
              type="button"
              className="btn-quiet btn-xs"
              disabled={placement.page >= placement.totalPages - 1}
              onClick={() => setSpecialistPage((p) => Math.min(placement.totalPages - 1, p + 1))}
            >
              Próxima Ala ▶
            </button>
          </div>
        </div>
      )}
      <div ref={host} className="world" />
    </div>
  )
}
