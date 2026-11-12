import { useState } from 'react'
import { ConceptCommandCenter } from './ConceptCommandCenter.tsx'
import { ConceptLivingWorkspace } from './ConceptLivingWorkspace.tsx'
import { ConceptHybridStudio } from './ConceptHybridStudio.tsx'
import { ConceptHybridWorkspace } from './ConceptHybridWorkspace.tsx'
import './prototypes.css'

interface Props {
  onBackToApp: () => void
}

export function PrototypeShowcase({ onBackToApp }: Props) {
  const [selectedConcept, setSelectedConcept] = useState<'A' | 'B' | 'C' | 'D'>('D')

  return (
    <div className="proto-showcase-shell">
      {/* Barra de Navegação entre os Conceitos */}
      <nav className="proto-top-nav" aria-label="Navegação dos Protótipos Visuais">
        <div className="proto-nav-brand">
          <span className="proto-logo-gem">✦</span>
          <div>
            <h1>Laboratório de Redesign Visual — Etapa 9.1</h1>
            <p>Avalie as propostas visuais para o novo AI Dev World</p>
          </div>
        </div>

        <div className="proto-nav-selector">
          <button
            type="button"
            className={`proto-nav-tab ${selectedConcept === 'D' ? 'is-active' : ''}`}
            onClick={() => setSelectedConcept('D')}
          >
            <strong>✨ Conceito D (Mix B+C)</strong>
            <span>Living Studio 2.5D</span>
          </button>
          <button
            type="button"
            className={`proto-nav-tab ${selectedConcept === 'B' ? 'is-active' : ''}`}
            onClick={() => setSelectedConcept('B')}
          >
            <strong>Conceito B</strong>
            <span>Living Workspace 2.5D</span>
          </button>
          <button
            type="button"
            className={`proto-nav-tab ${selectedConcept === 'C' ? 'is-active' : ''}`}
            onClick={() => setSelectedConcept('C')}
          >
            <strong>Conceito C</strong>
            <span>Hybrid Studio</span>
          </button>
          <button
            type="button"
            className={`proto-nav-tab ${selectedConcept === 'A' ? 'is-active' : ''}`}
            onClick={() => setSelectedConcept('A')}
          >
            <strong>Conceito A</strong>
            <span>AI Command Center</span>
          </button>
        </div>

        <button type="button" className="proto-btn-back" onClick={onBackToApp}>
          ← Voltar à Aplicação Oficial
        </button>
      </nav>

      {/* Renderização do Conceito Selecionado */}
      <main className="proto-stage-area">
        {selectedConcept === 'D' && <ConceptHybridWorkspace />}
        {selectedConcept === 'B' && <ConceptLivingWorkspace />}
        {selectedConcept === 'C' && <ConceptHybridStudio />}
        {selectedConcept === 'A' && <ConceptCommandCenter />}
      </main>
    </div>
  )
}
