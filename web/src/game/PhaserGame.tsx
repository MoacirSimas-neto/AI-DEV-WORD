import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { FONT, WORLD } from './officeLayout.ts'
import { OfficeScene } from './OfficeScene.ts'
import { WorldBridge } from './WorldBridge.ts'

interface Props {
  agents: AgentInfo[]
  selectedId: string | null
  /** Precisa ser estável (ex.: um setState), pois recria o jogo se mudar. */
  onSelect: (id: string) => void
}

/** Monta o jogo Phaser uma vez e repassa as props para a cena pela WorldBridge. */
export function PhaserGame({ agents, selectedId, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<WorldBridge | null>(null)

  useEffect(() => {
    const bridge = new WorldBridge()
    bridge.on('select', onSelect)
    bridgeRef.current = bridge
    let game: Phaser.Game | undefined
    let disposed = false

    // O Phaser desenha texto num canvas: a fonte precisa estar carregada antes.
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
          backgroundColor: '#1d1626',
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
