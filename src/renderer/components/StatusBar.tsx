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
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const viewHeight = useStore((s) => s.viewHeight)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)

  const samplesPerPixel = Math.max(1, Math.round(fftSize / zoomLevel))

  // Convert cursor Y pixel positions to frequencies (same formula as CursorOverlay)
  const yNormOffset = viewHeight > 0 ? yScrollOffset / (fftSize / 2) : 0
  const pxToFreq = (y: number) => (0.5 - yNormOffset - y / viewHeight / yZoomLevel) * sampleRate

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
          <StatusItem label="X Zoom" value={`${zoomLevel.toFixed(2)}x`} />
          {yZoomLevel > 1 && <StatusItem label="Y Zoom" value={`${yZoomLevel}x`} />}
          <StatusItem label="Offset" value={
            xAxisMode === 'time'
              ? formatTimeValue(scrollOffset / sampleRate)
              : `${scrollOffset}`
          } />

          {cursors.enabled && cursors.x1 !== cursors.x2 && (
            <>
              <Divider />
              <StatusItem
                label="\u0394t"
                value={
                  xAxisMode === 'time'
                    ? formatTimeValue(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel / sampleRate)
                    : `${Math.round(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel)}`
                }
              />
            </>
          )}
          {cursors.enabled && cursors.y1 !== cursors.y2 && viewHeight > 0 && (
            <>
              <Divider />
              <StatusItem
                label="\u0394f"
                value={formatFrequency(Math.abs(pxToFreq(cursors.y1) - pxToFreq(cursors.y2)))}
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
