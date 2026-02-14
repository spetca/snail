import React, { useState } from 'react'
import { useStore } from '../state/store'
import type { SampleFormat } from '../../shared/sample-formats'

interface CorrelationDialogProps {
  onClose: () => void
}

const FORMATS: SampleFormat[] = [
  'cf32', 'cf64', 'cs32', 'cs16', 'cs8', 'cu8',
  'rf32', 'rf64', 'rs16', 'rs8', 'ru8'
]

export function CorrelationDialog({ onClose }: CorrelationDialogProps): React.ReactElement {
  const cursors = useStore((s) => s.cursors)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const setCorrelationData = useStore((s) => s.setCorrelationData)
  const setCorrelationLoading = useStore((s) => s.setCorrelationLoading)
  const setCorrelationPaneVisible = useStore((s) => s.setCorrelationPaneVisible)
  const setCorrelationStartSample = useStore((s) => s.setCorrelationStartSample)
  const setCorrelationLag = useStore((s) => s.setCorrelationLag)

  const [format, setFormat] = useState<SampleFormat>('cf32')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const samplesPerPixel = fftSize / zoomLevel
  const templateStart = Math.round(Math.min(cursors.x1, cursors.x2) * samplesPerPixel)
  const templateLength = Math.round(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel)

  const handleCorrelate = async () => {
    try {
      setRunning(true)
      setError(null)
      setCorrelationLoading(true)

      const path = await window.snailAPI.showOpenDialog()
      if (!path) {
        setRunning(false)
        setCorrelationLoading(false)
        return
      }

      const result = await window.snailAPI.correlate({
        templateStart,
        templateLength: Math.max(templateLength, 1024),
        secondFilePath: path,
        secondFileFormat: format
      })

      setCorrelationData(result)
      setCorrelationStartSample(scrollOffset)
      setCorrelationLag(0)
      setCorrelationPaneVisible(true)
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRunning(false)
      setCorrelationLoading(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Cross-Correlation</h3>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Template Range
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {cursors.enabled
              ? `${templateStart} - ${templateStart + templateLength} (${templateLength} samples)`
              : 'Enable cursors to select a template range'}
          </span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Second File Format
          </div>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as SampleFormat)}
            style={{ width: '100%' }}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
          Click "Correlate" to pick a second file and compute FFT-based cross-correlation.
        </p>

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleCorrelate} disabled={running}>
            {running ? 'Computing...' : 'Correlate'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
}

const modalStyle: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  width: 400,
  maxWidth: '90%'
}
