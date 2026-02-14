import React from 'react'
import { useStore } from '../state/store'

interface ToolbarProps {
  onExport: () => void
  onAnnotate: () => void
}

export function Toolbar({ onExport, onAnnotate }: ToolbarProps): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const setFileInfo = useStore((s) => s.setFileInfo)
  const setLoading = useStore((s) => s.setLoading)
  const setError = useStore((s) => s.setError)
  const cursors = useStore((s) => s.cursors)
  const correlationEnabled = useStore((s) => s.correlationEnabled)
  const setCorrelationEnabled = useStore((s) => s.setCorrelationEnabled)

  const handleOpen = async () => {
    try {
      const path = await window.snailAPI.showOpenDialog()
      if (!path) return
      setLoading(true)
      const info = await window.snailAPI.openFile(path)
      setFileInfo(info)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        paddingTop: navigator.userAgent.includes('Mac') ? 42 : 8,
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'no-drag' as any
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', marginRight: 12 }}>
        Snail
      </span>

      <button onClick={handleOpen}>Open File</button>

      {fileInfo && (
        <>
          <button onClick={onExport}>Export SigMF</button>
          {cursors.enabled && (
            <button onClick={onAnnotate}>Annotate</button>
          )}
          <button
            onClick={() => setCorrelationEnabled(!correlationEnabled)}
            style={correlationEnabled ? {
              background: 'var(--accent)',
              color: '#000',
              borderColor: 'var(--accent)'
            } : undefined}
          >
            Correlate{correlationEnabled ? ' ON' : ''}
          </button>
        </>
      )}

      <div style={{ flex: 1 }} />

      {fileInfo && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {fileInfo.path.split('/').pop()}
        </span>
      )}
    </div>
  )
}
