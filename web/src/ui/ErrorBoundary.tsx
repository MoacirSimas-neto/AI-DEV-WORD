import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou erro:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="error-boundary-banner" role="alert">
          <div className="error-boundary-content">
            <h3>{this.props.fallbackTitle ?? 'Ocorreu um erro inesperado nesta seção'}</h3>
            <p className="error-boundary-message">
              {this.state.error?.message ?? 'Erro desconhecido durante a renderização.'}
            </p>
            <div className="error-boundary-actions">
              <button
                type="button"
                className="btn-quiet"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
              >
                Recarregar página
              </button>
            </div>
          </div>
        </section>
      )
    }

    return this.props.children
  }
}
