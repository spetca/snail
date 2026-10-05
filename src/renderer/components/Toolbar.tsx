import { openRecording } from '../utils/recording'
import React from 'react'
import { useStore } from '../state/store'

interface ToolbarProps {
  onExport: () => void
  onAnnotate: () => void
  onOpen: (filePath: string) => void
  onHopTable: () => void
}

export function Toolbar({ onExport, onAnnotate, onOpen, onHopTable }: ToolbarProps): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const setError = useStore((s) => s.setError)
  const cursors = useStore((s) => s.cursors)
  const showDetectionPanel = useStore(s => s.showDetectionPanel)
  const setShowDetectionPanel = useStore(s => s.setShowDetectionPanel)
  const correlationEnabled = useStore((s) => s.correlationEnabled)
  const setCorrelationEnabled = useStore((s) => s.setCorrelationEnabled)

  const handleOpen = async () => {
    try {
      const path = await window.snailAPI.showOpenDialog()
      if (!path) return
      onOpen(path)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const isMac = navigator.userAgent.includes('Mac')

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        paddingTop: isMac ? 42 : 8,
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: isMac ? 'drag' : 'no-drag'
      } as any}
    >
      <span style={{
        fontWeight: 600,
        fontSize: 14,
        color: 'var(--accent)',
        marginRight: 12,
        WebkitAppRegion: 'no-drag'
      } as any}>
        Snail
      </span>

      <button onClick={handleOpen} style={{ WebkitAppRegion: 'no-drag' } as any}>Open File</button>

      {fileInfo && (
        <>
          {fileInfo.collection && <select aria-label="Collection stream" value={fileInfo.collection.streamIndex}
            style={{ WebkitAppRegion: 'no-drag', maxWidth: 220 }}
            onChange={e => void openRecording(fileInfo.collection!.path, undefined, 0, { streamIndex: Number(e.target.value) })}>
            {fileInfo.collection.streams.map((stream, i) => <option key={i} value={i}>{stream.name}</option>)}
          </select>}
          {(fileInfo.numChannels ?? 1) > 1 && <label style={{ WebkitAppRegion: 'no-drag' }}>Channel{' '}
            <input aria-label="Channel" type="number" min={0} max={fileInfo.numChannels! - 1}
              style={{ width: 65 }} value={fileInfo.channel ?? 0} onChange={e => {
                const channel = e.target.valueAsNumber
                if (Number.isInteger(channel) && channel >= 0 && channel < fileInfo.numChannels!)
                  void openRecording(fileInfo.collection?.path ?? fileInfo.path, undefined, 0,
                    { channel, streamIndex: fileInfo.collection?.streamIndex })
              }} /> / {fileInfo.numChannels! - 1}
          </label>}
          <button onClick={onExport} style={{ WebkitAppRegion: 'no-drag' } as any}>Export SigMF</button>
          {cursors.enabled && (
            <button onClick={onAnnotate} style={{ WebkitAppRegion: 'no-drag' } as any}>Annotate</button>
          )}
          <button
            onClick={() => setCorrelationEnabled(!correlationEnabled)}
            style={{
              WebkitAppRegion: 'no-drag' as any,
              ...(correlationEnabled ? {
                background: 'var(--accent)',
                color: '#000',
                borderColor: 'var(--accent)'
              } : {})
            }}
          >
            Correlate{correlationEnabled ? ' ON' : ''}
          </button>
          <button onClick={() => setShowDetectionPanel(!showDetectionPanel)} aria-pressed={showDetectionPanel} style={{ WebkitAppRegion: 'no-drag' }}>
            Detect & label
          </button>
          <button onClick={onHopTable} style={{ WebkitAppRegion: 'no-drag' } as any}>
            Hop Table
          </button>
        </>
      )}

      <div style={{ flex: 1, height: '100%', WebkitAppRegion: 'drag' } as any} />

      {fileInfo && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-muted)',
          WebkitAppRegion: 'no-drag' as any
        }}>
          {fileInfo.path.split('/').pop()}
        </span>
      )}
    </div>
  )
}
