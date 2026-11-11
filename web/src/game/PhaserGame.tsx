import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { FONT, WORLD } from './officeLayout.ts'
import { OfficeScene } from './OfficeScene.ts'
import { type WorldAction, WorldBridge } from './WorldBridge.ts'

interface Props {
  agents: AgentInfo[]
  selectedId: string | null
  /** Precisa ser estável (ex.: useCallback), pois recria o jogo se mudar. */
  onSelect: (id: string) => void
  onAction?: (action: WorldAction) => void
}

/** Monta o jogo Phaser uma vez e repassa as props para a cena pela WorldBridge. */
export function PhaserGame({ agents, selectedId, onSelect, onAction }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<WorldBridge | null>(null)
  const onActionRef = useRef(onAction)

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  useEffect(() => {
    const bridge = new WorldBridge()
    bridge.on('select', onSelect)
    bridge.on('action', (action: WorldAction) => onActionRef.current?.(action))
    bridgeRef.current = bridge
    let game: Phaser.Game | undefined
    let disposed = false

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
          pixelArt: true,
          backgroundColor: '#0f172a',
          scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
          scene: new OfficeScene(bridge),
        })
      })

    return () => {
      disposed = true
      bridgeRef.current = null
      bridge.removeAllListeners()
      game?.destroy(true)
    }
  }, [onSelect])

  useEffect(() => bridgeRef.current?.setAgents(agents), [agents])
  useEffect(() => bridgeRef.current?.setSelected(selectedId), [selectedId])

  return <div ref={host} className="world" />
}
