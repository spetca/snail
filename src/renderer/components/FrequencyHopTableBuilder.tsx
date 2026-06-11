import React, { useState, useCallback } from 'react'
import { useStore } from '../state/store'
import type { PulseRecord } from '../../shared/sample-formats'
import { HopVisualizer } from './HopVisualizer'

interface Props {
  onClose: () => void
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  if (secs < 0) return '—'
  if (secs < 1e-3) return `${(secs * 1e6).toFixed(2)} µs`
  if (secs < 1) return `${(secs * 1e3).toFixed(4)} ms`
  return `${secs.toFixed(6)} s`
}

function fmtFreq(hz: number): string {
  const abs = Math.abs(hz)
  if (abs < 1e3) return `${hz.toFixed(1)} Hz`
  if (abs < 1e6) return `${(hz / 1e3).toFixed(3)} kHz`
  return `${(hz / 1e6).toFixed(4)} MHz`
}

function exportCSV(pulses: PulseRecord[]): void {
  const header = 'Pulse #,Start (s),End (s),Width (µs),Center Freq (MHz),OBW (MHz),PRI (µs)\n'
  const rows = pulses.map((p) => [
    p.pulseNumber,
    p.startTimeSecs.toFixed(9),
    p.endTimeSecs.toFixed(9),
    (p.measuredWidthSecs * 1e6).toFixed(2),
    (p.centerFrequencyHz / 1e6).toFixed(6),
    (p.occupiedBandwidthHz / 1e6).toFixed(6),
    p.priSecs >= 0 ? (p.priSecs * 1e6).toFixed(2) : ''
  ].join(',')).join('\n')

  const blob = new Blob([header + rows], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'freq_hop_table.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg1)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 4,
  padding: '5px 8px',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box'
}

const unitStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 11,
  minWidth: 28,
  textAlign: 'right' as const
}

// ── Parameter pair: value  ±  tolerance, stacked rows ─────────────────────

function ParamRow({
  label, value, tol, onValue, onTol, unit
}: {
  label: string
  value: string
  tol: string
  onValue: (v: string) => void
  onTol: (v: string) => void
  unit: string
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          style={inputStyle}
        />
        <span style={unitStyle}>{unit}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 }}>±</span>
          <input
            type="text"
            inputMode="decimal"
            value={tol}
            onChange={(e) => onTol(e.target.value)}
            style={inputStyle}
            placeholder="tolerance"
          />
        </div>
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  )
}

// ── Single-value row ───────────────────────────────────────────────────────

function SingleRow({
  label, value, onChange, unit
}: {
  label: string
  value: string
  onChange: (v: string) => void
  unit: string
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function FrequencyHopTableBuilder({ onClose }: Props): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const sampleRate = useStore((s) => s.sampleRate)
  const cursors = useStore((s) => s.cursors)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const viewWidth = useStore((s) => s.viewWidth)

  // All inputs as strings so decimal typing works freely
  const [pulseWidthUs, setPulseWidthUs] = useState('513')
  const [pulseWidthTolUs, setPulseWidthTolUs] = useState('50')
  const [obwMHz, setObwMHz] = useState('1.25')
  const [obwTolMHz, setObwTolMHz] = useState('0.25')
  const [threshDb, setThreshDb] = useState('10')
  const [obwPct, setObwPct] = useState('99')
  const [region, setRegion] = useState<'all' | 'view' | 'cursors'>('view')

  const [running, setRunning] = useState(false)
  const [pulses, setPulses] = useState<PulseRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [rightTab, setRightTab] = useState<'table' | 'viz'>('table')

  const getRange = useCallback(() => {
    if (!fileInfo) return {}
    if (region === 'all') return {}
    if (region === 'view') {
      const stride = Math.max(1, Math.round(fftSize / zoomLevel))
      return {
        startSample: scrollOffset,
        endSample: Math.min(fileInfo.totalSamples, scrollOffset + viewWidth * stride)
      }
    }
    if (region === 'cursors' && cursors.enabled) {
      const stride = Math.max(1, Math.round(fftSize / zoomLevel))
      const x1 = Math.min(cursors.x1, cursors.x2)
      const x2 = Math.max(cursors.x1, cursors.x2)
      return {
        startSample: Math.round(scrollOffset + x1 * stride),
        endSample: Math.round(scrollOffset + x2 * stride)
      }
    }
    return {}
  }, [fileInfo, region, cursors, scrollOffset, fftSize, zoomLevel, viewWidth])

  const handleRun = useCallback(async () => {
    if (!fileInfo) return
    const pw = parseFloat(pulseWidthUs)
    const pwt = parseFloat(pulseWidthTolUs)
    const obw = parseFloat(obwMHz)
    const obwt = parseFloat(obwTolMHz)
    const thr = parseFloat(threshDb)
    const pct = parseFloat(obwPct)

    if ([pw, pwt, obw, obwt, thr, pct].some(isNaN)) {
      setError('All fields must be valid numbers.')
      return
    }

    setRunning(true)
    setError(null)
    const t0 = performance.now()
    try {
      const result = await window.snailAPI.findPulses({
        targetWidthSecs: pw * 1e-6,
        widthTolSecs:    pwt * 1e-6,
        targetOBWHz:     obw * 1e6,
        obwTolHz:        obwt * 1e6,
        sampleRate,
        thresholdDb:     thr,
        obwPercentile:   pct / 100,
        ...getRange()
      })
      setPulses(result)
      setElapsed(performance.now() - t0)
      if (result.length > 1) setRightTab('viz')
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [fileInfo, sampleRate, pulseWidthUs, pulseWidthTolUs, obwMHz, obwTolMHz,
      threshDb, obwPct, getRange])

  const sectionLabel: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 10
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        width: 860,
        maxHeight: '88vh',
        height: 620,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
      }}>

        {/* ── Title bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg3)'
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            Frequency Hop Table Builder
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px'
          }}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── Left: config ── */}
          <div style={{
            width: 260,
            padding: '16px 16px',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            flexShrink: 0,
            overflowY: 'auto'
          }}>
            <div style={sectionLabel}>Pulse Parameters</div>

            <ParamRow
              label="Width (µs)"
              value={pulseWidthUs} onValue={setPulseWidthUs}
              tol={pulseWidthTolUs} onTol={setPulseWidthTolUs}
              unit="µs"
            />

            <ParamRow
              label="Occupied BW (MHz)"
              value={obwMHz} onValue={setObwMHz}
              tol={obwTolMHz} onTol={setObwTolMHz}
              unit="MHz"
            />

            <SingleRow label="OBW Percentile" value={obwPct} onChange={setObwPct} unit="%" />
            <SingleRow label="Threshold above noise" value={threshDb} onChange={setThreshDb} unit="dB" />

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={sectionLabel}>Search Region</div>
              {(['all', 'view', 'cursors'] as const).map((opt) => {
                const disabled = opt === 'cursors' && !cursors.enabled
                return (
                  <label key={opt} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: 8, cursor: disabled ? 'default' : 'pointer',
                    color: disabled ? 'var(--text-dim)' : 'var(--text)',
                    fontSize: 13
                  }}>
                    <input
                      type="radio" name="region" value={opt}
                      checked={region === opt}
                      disabled={disabled}
                      onChange={() => setRegion(opt)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {opt === 'all' ? 'Entire file' : opt === 'view' ? 'Current view' : 'Cursor selection'}
                  </label>
                )
              })}
            </div>

            <div style={{ flex: 1 }} />

            {error && (
              <div style={{
                background: 'rgba(255,107,107,0.1)',
                border: '1px solid rgba(255,107,107,0.3)',
                borderRadius: 5, padding: '7px 10px',
                color: '#ff6b6b', fontSize: 12, lineHeight: 1.4
              }}>{error}</div>
            )}

            <button
              onClick={handleRun}
              disabled={running || !fileInfo}
              style={{
                padding: '9px 0',
                borderRadius: 6,
                border: 'none',
                background: running || !fileInfo ? 'var(--bg3)' : 'var(--accent)',
                color: running || !fileInfo ? 'var(--text-muted)' : '#fff',
                cursor: running || !fileInfo ? 'default' : 'pointer',
                fontWeight: 600,
                fontSize: 13,
                letterSpacing: '0.02em'
              }}
            >
              {running ? 'Scanning…' : 'Find Pulses'}
            </button>
          </div>

          {/* ── Right: results ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex', alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg3)', flexShrink: 0
            }}>
              {(['table', 'viz'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  disabled={!pulses || pulses.length === 0}
                  style={{
                    padding: '8px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: rightTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                    color: rightTab === tab ? 'var(--text)' : 'var(--text-muted)',
                    cursor: !pulses || pulses.length === 0 ? 'default' : 'pointer',
                    fontSize: 12,
                    fontWeight: rightTab === tab ? 600 : 400,
                    marginBottom: -1
                  }}
                >
                  {tab === 'table' ? 'Table' : 'Visualize'}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ color: 'var(--text-dim)', fontSize: 11, paddingRight: 10 }}>
                {pulses === null ? 'No results yet'
                  : pulses.length === 0 ? 'No pulses found'
                  : `${pulses.length} pulse${pulses.length !== 1 ? 's' : ''}${elapsed !== null ? ` · ${elapsed.toFixed(0)} ms` : ''}`}
              </span>
              {pulses && pulses.length > 0 && (
                <button
                  onClick={() => exportCSV(pulses)}
                  style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)',
                    color: 'var(--text)', borderRadius: 4, padding: '4px 11px',
                    cursor: 'pointer', fontSize: 11, marginRight: 8
                  }}
                >Export CSV</button>
              )}
            </div>

            {/* Visualize tab */}
            {rightTab === 'viz' && pulses && pulses.length > 0 && (
              <HopVisualizer pulses={pulses} sampleRate={sampleRate} />
            )}

            {/* Table tab */}
            <div style={{ flex: 1, overflow: 'auto', display: rightTab === 'table' ? 'block' : 'none' }}>
              {pulses && pulses.length > 0 ? (
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)'
                }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
                    <tr>
                      {[
                        ['#', 40],
                        ['Start Time', 90],
                        ['End Time', 90],
                        ['Width', 80],
                        ['Center Freq', 100],
                        ['OBW', 80],
                        ['PRI', 80]
                      ].map(([h, w]) => (
                        <th key={h} style={{
                          padding: '6px 10px',
                          textAlign: 'left',
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          fontWeight: 500,
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.07em',
                          width: w,
                          whiteSpace: 'nowrap'
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pulses.map((p, i) => (
                      <tr
                        key={p.pulseNumber}
                        style={{
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                          borderBottom: '1px solid rgba(255,255,255,0.04)'
                        }}
                      >
                        <td style={{ padding: '5px 10px', color: 'var(--text-dim)' }}>{p.pulseNumber}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text)' }}>{fmtTime(p.startTimeSecs)}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text)' }}>{fmtTime(p.endTimeSecs)}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text)' }}>{fmtTime(p.measuredWidthSecs)}</td>
                        <td style={{ padding: '5px 10px', color: '#4fc3f7', fontWeight: 500 }}>{fmtFreq(p.centerFrequencyHz)}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text)' }}>{fmtFreq(p.occupiedBandwidthHz)}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text-muted)' }}>
                          {p.priSecs >= 0 ? fmtTime(p.priSecs) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  gap: 10,
                  color: 'var(--text-dim)',
                  fontSize: 13
                }}>
                  {pulses && pulses.length === 0 ? (
                    <>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                      </svg>
                      <span>No pulses matched — try relaxing tolerances or lowering threshold</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Results will appear here</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
