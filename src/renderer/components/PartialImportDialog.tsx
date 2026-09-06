import { NumericInput } from './NumericInput'
import { requireValidInputs } from '../utils/numeric-input'
import React, { useState, useRef } from 'react'
import type { ProbeResult } from '../../shared/sample-formats'

interface Props {
  filePath: string
  probe: ProbeResult
  onConfirm: (viewStart: number, viewLength: number) => void
  onCancel: () => void
}

function formatDuration(samples: number, sampleRate: number): string {
  const secs = samples / sampleRate
  if (secs < 0.001) return `${(secs * 1e6).toFixed(1)} µs`
  if (secs < 1) return `${(secs * 1000).toFixed(2)} ms`
  if (secs < 60) return `${secs.toFixed(3)} s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s.toFixed(1)}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function PartialImportDialog({ filePath, probe, onConfirm, onCancel }: Props): React.ReactElement {
  const { totalSamples, sampleRate, fileSize } = probe

  const totalSecs = totalSamples / sampleRate

  const [startSecs, setStartSecs] = useState(0)
  const [endSecs, setEndSecs] = useState(Math.min(totalSecs, 60))

  const fields = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  const clampedStart = Math.max(0, Math.min(startSecs, totalSecs))
  const clampedEnd = Math.max(clampedStart, Math.min(endSecs, totalSecs))
  const selectionSamples = Math.round(clampedEnd * sampleRate) - Math.round(clampedStart * sampleRate)
  const viewStart = Math.round(clampedStart * sampleRate)

  const fileName = filePath.split('/').pop() ?? filePath

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 4,
    padding: '4px 8px',
    width: 110,
    fontSize: 13
  }

  const labelStyle: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: 12,
    minWidth: 36
  }

  return (
    <div ref={fields} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 24,
        width: 420,
        display: 'flex', flexDirection: 'column', gap: 16
      }}>
        <div>
          <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            Import File
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {fileName}
          </div>
        </div>

        <div style={{
          background: 'var(--bg3)', borderRadius: 6, padding: '10px 14px',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 0',
          fontSize: 12
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Total samples</span>
          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{totalSamples.toLocaleString()}</span>
          <span style={{ color: 'var(--text-muted)' }}>Duration</span>
          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{formatDuration(totalSamples, sampleRate)}</span>
          <span style={{ color: 'var(--text-muted)' }}>Sample rate</span>
          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{(sampleRate / 1e6).toFixed(3)} MHz</span>
          <span style={{ color: 'var(--text-muted)' }}>File size</span>
          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{formatBytes(fileSize)}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>
            Select range to load
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={labelStyle}>Start</span>
            <NumericInput aria-label="Import start (seconds)"
              style={inputStyle}
              value={startSecs}
              min={0}
              max={totalSecs}
              onValueChange={setStartSecs}
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>s</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={labelStyle}>End</span>
            <NumericInput aria-label="Import end (seconds)"
              style={inputStyle}
              value={endSecs}
              min={0}
              max={totalSecs}
              onValueChange={setEndSecs}
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>s</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, paddingLeft: 46 }}>
            {selectionSamples.toLocaleString()} samples · {formatDuration(selectionSamples, sampleRate)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, paddingLeft: 46 }}>
            Full file loads — view jumps to this range
          </div>
        </div>

        {error && <p role="alert" style={{ color: 'var(--error, #ff6b6b)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px', borderRadius: 5, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(0, 0)}
            style={{
              padding: '6px 14px', borderRadius: 5, border: '1px solid var(--border)',
              background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13
            }}
          >
            Load Full File
          </button>
          <button
            onClick={() => {
              try {
                requireValidInputs(fields.current)
                if (selectionSamples <= 0 || endSecs <= startSecs) throw new Error('Choose an end time after the start, spanning at least one sample.')
                onConfirm(viewStart, selectionSamples)
              } catch (error) { setError(String(error)) }
            }}
            title="Opens the full file, jumps view to this range"
            style={{
              padding: '6px 14px', borderRadius: 5, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500
            }}
          >
            Load Selection
          </button>
        </div>
      </div>
    </div>
  )
}
