import React from 'react'
import { useStore, type XAxisMode } from '../state/store'

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

  const setFFTSize = useStore((s) => s.setFFTSize)
  const setZoomLevel = useStore((s) => s.setZoomLevel)
  const setPowerMin = useStore((s) => s.setPowerMin)
  const setPowerMax = useStore((s) => s.setPowerMax)
  const setSampleRate = useStore((s) => s.setSampleRate)
  const setXAxisMode = useStore((s) => s.setXAxisMode)
  const setCursorsEnabled = useStore((s) => s.setCursorsEnabled)

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
          min={1}
          max={16}
          step={1}
          value={zoomLevel}
          onChange={(e) => setZoomLevel(Number(e.target.value))}
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
