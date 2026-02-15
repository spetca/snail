import React from 'react'
import { useStore } from '../state/store'
import { formatTimeValue, formatFrequency, formatSampleRate } from '../../shared/units'
import { version } from '../../../package.json'

export function StatusBar(): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const xAxisMode = useStore((s) => s.xAxisMode)
  const cursors = useStore((s) => s.cursors)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)

  const samplesPerPixel = fftSize / zoomLevel

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '4px 16px',
        background: 'var(--bg0)',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-muted)',
        height: 28
      }}
    >
      {loading && <span style={{ color: 'var(--accent)' }}>Loading...</span>}
      {error && <span style={{ color: 'var(--error)' }}>{error}</span>}

      {fileInfo && (
        <>
          <StatusItem label="Rate" value={formatSampleRate(sampleRate)} />
          <StatusItem label="FFT" value={`${fftSize}`} />
          <StatusItem label="Zoom" value={`${zoomLevel}x`} />
          <StatusItem label="Offset" value={
            xAxisMode === 'time'
              ? formatTimeValue(scrollOffset / sampleRate)
              : `${scrollOffset}`
          } />

          {cursors.enabled && cursors.x1 !== cursors.x2 && (
            <>
              <Divider />
              <StatusItem
                label="\u0394"
                value={
                  xAxisMode === 'time'
                    ? formatTimeValue(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel / sampleRate)
                    : `${Math.round(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel)}`
                }
              />
            </>
          )}
        </>
      )}

      <div style={{ flex: 1 }} />
      <span style={{ color: 'var(--text-dim)' }}>Snail v{version}</span>
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: 'var(--text-dim)' }}>{label}: </span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </span>
  )
}

function Divider() {
  return <span style={{ color: 'var(--border)' }}>|</span>
}
