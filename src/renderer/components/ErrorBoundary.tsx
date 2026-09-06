import React from 'react'
import { useStore } from '../state/store'

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('Snail view failed', error, info) }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 32, color: 'var(--text)', background: 'var(--bg1)', height: '100%' }}>
        <p>Snail could not render this view.</p>
        <pre style={{ whiteSpace: 'pre-wrap', margin: '16px 0' }}>{this.state.error.message}</pre>
        <button onClick={() => { useStore.getState().setFileInfo(null); this.setState({ error: null }) }}>
          Close recording and recover
        </button>
      </div>
    )
  }
}
