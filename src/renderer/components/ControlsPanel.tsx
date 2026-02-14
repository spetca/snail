import React from 'react'
import { useStore, type XAxisMode } from '../state/store'
import type { SigMFAnnotation } from '../../shared/sample-formats'

const ANNOTATION_COLORS = ['#FF6B6B', '#4DABF7', '#51CF66', '#FFD43B', '#CC5DE8', '#FF922B']

const FFT_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192]

export function ControlsPanel(): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const powerMin = useStore((s) => s.powerMin)
  const powerMax = useStore((s) => s.powerMax)
  const sampleRate = useStore((s) => s.sampleRate)
  const xAxisMode = useStore((s) => s.xAxisMode)
  const cursorsEnabled = useStore((s) => s.cursors.enabled)
  const annotations = useStore((s) => s.annotations)
  const viewWidth = useStore((s) => s.viewWidth)
  const selectedAnnotationIndex = useStore((s) => s.selectedAnnotationIndex)
  const setSelectedAnnotationIndex = useStore((s) => s.setSelectedAnnotationIndex)

  const setFFTSize = useStore((s) => s.setFFTSize)
  const setZoomLevel = useStore((s) => s.setZoomLevel)
  const setPowerMin = useStore((s) => s.setPowerMin)
  const setPowerMax = useStore((s) => s.setPowerMax)
  const setSampleRate = useStore((s) => s.setSampleRate)
  const setXAxisMode = useStore((s) => s.setXAxisMode)
  const setCursorsEnabled = useStore((s) => s.setCursorsEnabled)
  const setScrollOffset = useStore((s) => s.setScrollOffset)

  const handleAnnotationClick = (ann: SigMFAnnotation) => {
    if (!fileInfo) return
    // Zoom so annotation fills ~80% of the viewport width
    const targetZoom = Math.round((viewWidth * fftSize * 0.8) / ann.sampleCount)
    const newZoom = Math.max(1, Math.min(fftSize, targetZoom))
    setZoomLevel(newZoom)

    const newStride = fftSize / newZoom
    const centerSample = ann.sampleStart + ann.sampleCount / 2
    const viewSamples = viewWidth * newStride
    const newOffset = centerSample - viewSamples / 2
    const maxOffset = Math.max(0, fileInfo.totalSamples - fftSize)
    setScrollOffset(Math.max(0, Math.min(maxOffset, Math.round(newOffset))))
  }

  return (
    <div
      style={{
        width: 220,
        background: 'var(--bg2)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
        borderRight: '1px solid var(--border)'
      }}
    >
      <Section title="Sample Rate">
        <input
          type="number"
          value={sampleRate}
          onChange={(e) => setSampleRate(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </Section>

      <Section title="FFT Size">
        <select
          value={fftSize}
          onChange={(e) => setFFTSize(Number(e.target.value))}
          style={{ width: '100%' }}
        >
          {FFT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Section>

      <Section title="Zoom">
        <input
          type="range"
          min={0}
          max={Math.log2(fftSize)}
          step={0.25}
          value={Math.log2(zoomLevel)}
          onChange={(e) => {
            const z = Math.round(Math.pow(2, Number(e.target.value)))
            setZoomLevel(Math.max(1, Math.min(fftSize, z)))
          }}
        />
        <span style={valStyle}>{zoomLevel}x</span>
      </Section>

      <Section title="Power (dB)">
        <label style={labelStyle}>
          Min
          <input
            type="range"
            min={-150}
            max={0}
            value={powerMin}
            onChange={(e) => setPowerMin(Number(e.target.value))}
          />
          <span style={valStyle}>{powerMin}</span>
        </label>
        <label style={labelStyle}>
          Max
          <input
            type="range"
            min={-150}
            max={0}
            value={powerMax}
            onChange={(e) => setPowerMax(Number(e.target.value))}
          />
          <span style={valStyle}>{powerMax}</span>
        </label>
      </Section>

      <Section title="X Axis">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['samples', 'time'] as XAxisMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setXAxisMode(mode)}
              style={{
                flex: 1,
                background: xAxisMode === mode ? 'var(--accent)' : 'var(--surface)',
                color: xAxisMode === mode ? 'var(--bg0)' : 'var(--text)',
                fontWeight: xAxisMode === mode ? 500 : 400,
                borderColor: xAxisMode === mode ? 'var(--accent)' : 'var(--border)'
              }}
            >
              {mode === 'samples' ? 'Samples' : 'Time'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Cursors">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cursorsEnabled}
            onChange={(e) => setCursorsEnabled(e.target.checked)}
          />
          <span style={{ fontSize: 12 }}>Enable cursors</span>
        </label>
      </Section>

      {fileInfo && (
        <Section title="File Info">
          <InfoRow label="Format" value={fileInfo.format} />
          <InfoRow label="Samples" value={fileInfo.totalSamples.toLocaleString()} />
          <InfoRow label="Size" value={formatBytes(fileInfo.fileSize)} />
          {fileInfo.centerFrequency && (
            <InfoRow label="Center" value={`${(fileInfo.centerFrequency / 1e6).toFixed(3)} MHz`} />
          )}
        </Section>
      )}

      {annotations.length > 0 && (
        <Section title="Annotations">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {annotations.map((ann, i) => {
              const color = ANNOTATION_COLORS[i % ANNOTATION_COLORS.length]
              const isSelected = selectedAnnotationIndex === i
              return (
                <div
                  key={i}
                  onClick={() => {
                    handleAnnotationClick(ann)
                    setSelectedAnnotationIndex(i)
                  }}
                  style={{
                    padding: '6px 8px',
                    background: isSelected ? `${color}33` : 'var(--bg3)',
                    border: `1px solid ${isSelected ? color : color + '44'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = color
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = `${color}44`
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {ann.label || `Annotation ${i + 1}`}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    S: {ann.sampleStart.toLocaleString()} ({ann.sampleCount.toLocaleString()})
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4
}

const valStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text)',
  minWidth: 40,
  textAlign: 'right'
}
