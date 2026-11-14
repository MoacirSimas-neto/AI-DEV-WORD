import { useState } from 'react'
import type {
  AgentConfig,
  AgentInfo,
  SkillAgentOverride,
  SkillInfo,
  SpecializationInfo,
} from '../../../shared/protocol.ts'
import type { AgentLoadStatus, MemoryConsentRequester, Send, Subscribe } from '../net/useServer.ts'
import { AgentCenter } from './AgentCenter.tsx'
import { MemoryCenter } from './MemoryCenter.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'

export type TeamSection = 'agents' | 'skills' | 'memory'

export function TeamCenter({
  initialSection = 'agents',
  loadStatus,
  agents,
  configs,
  allConfigs,
  specializations = [],
  skills = [],
  skillOverrides = [],
  projectId,
  projectName,
  online,
  send,
  subscribe,
  onRequestMemoryConsent,
  onClose,
}: {
  initialSection?: TeamSection
  loadStatus: AgentLoadStatus
  agents: AgentInfo[]
  configs: AgentConfig[]
  allConfigs?: AgentConfig[]
  specializations?: SpecializationInfo[]
  skills?: SkillInfo[]
  skillOverrides?: SkillAgentOverride[]
  projectId: number | null
  projectName?: string
  online: boolean
  send: Send
  subscribe: Subscribe
  onRequestMemoryConsent?: MemoryConsentRequester
  onClose: () => void
}) {
  const [section, setSection] = useState<TeamSection>(initialSection)

  return (
    <aside className="window team-center-window" aria-label="Central da Equipe">
      <header className="window-head team-center-head">
        <div className="window-id">
          <span className="agent-role">Equipe, Habilidades e Memória</span>
          <h2>Central da Equipe</h2>
        </div>
        <nav className="team-center-tabs" aria-label="Seções da Central da Equipe">
          <button
            type="button"
            className={`team-center-tab ${section === 'agents' ? 'active' : ''}`}
            aria-pressed={section === 'agents'}
            onClick={() => setSection('agents')}
          >
            Agentes
          </button>
          <button
            type="button"
            className={`team-center-tab ${section === 'skills' ? 'active' : ''}`}
            aria-pressed={section === 'skills'}
            onClick={() => setSection('skills')}
          >
            Skills
          </button>
          <button
            type="button"
            className={`team-center-tab ${section === 'memory' ? 'active' : ''}`}
            aria-pressed={section === 'memory'}
            onClick={() => setSection('memory')}
          >
            Memória
          </button>
        </nav>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar Central da Equipe" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="team-center-body">
        {section === 'agents' && (
          <AgentCenter
            loadStatus={loadStatus}
            agents={agents}
            configs={configs}
            allConfigs={allConfigs}
            specializations={specializations}
            skills={skills}
            skillOverrides={skillOverrides}
            online={online}
            hideSkillsPanel
            send={send}
            subscribe={subscribe}
            onClose={onClose}
          />
        )}

        {section === 'skills' && (
          <SkillsPanel
            skills={skills}
            overrides={skillOverrides}
            agents={configs}
            online={online}
            send={send}
          />
        )}

        {section === 'memory' && (
          <MemoryCenter
            projectId={projectId}
            projectName={projectName}
            agents={agents}
            online={online}
            send={send}
            subscribe={subscribe}
            onRequestMemoryConsent={onRequestMemoryConsent}
            onClose={onClose}
          />
        )}
      </div>
    </aside>
  )
}
