import React, { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../state/store'

const SPECTRUM_HEIGHT = 130
const MARGIN = { top: 8, right: 8, bottom: 24, left: 46 }
const AVG_ALPHA = 0.15 // EMA weight for average hold

export function RealtimeSpectrum(): React.ReactElement | null {
  const playheadSample = useStore((s) => s.playheadSample)
  const isPlaying = useStore((s) => s.isPlaying)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSettings = useStore((s) => s.fftSettings)
  const realtimeSpectrumMode = useStore((s) => s.realtimeSpectrumMode)
  const setRealtimeSpectrumMode = useStore((s) => s.setRealtimeSpectrumMode)
  const showRealtimeSpectrum = useStore((s) => s.showRealtimeSpectrum)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const lastComputedSampleRef = useRef<number>(-1e9)
  const maxHoldRef = useRef<Float32Array | null>(null)
  const avgHoldRef = useRef<Float32Array | null>(null)
  const lastDataRef = useRef<Float32Array | null>(null)
  const pendingRef = useRef(false)

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const clearHold = useCallback(() => {
    maxHoldRef.current = null
    avgHoldRef.current = null
    lastDataRef.current = null
    lastComputedSampleRef.current = -1e9
  }, [])

  const fftSize = fftSettings.fftSize
  const isLog = fftSettings.scale === 'log'

  const draw = useCallback((data: Float32Array) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = SPECTRUM_HEIGHT
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
    }

    const plotW = w - MARGIN.left - MARGIN.right
    const plotH = h - MARGIN.top - MARGIN.bottom
    if (plotW <= 0 || plotH <= 0) return

    // Clear
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, w, h)

    const n = data.length
    const minP = isLog ? -120 : 0
    const maxP = isLog ? 0 : (Math.max(...Array.from(data)) || 1) * 1.1

    const toY = (v: number) => {
      const norm = (v - minP) / (maxP - minP)
      return MARGIN.top + plotH * (1 - norm)
    }

    const toX = (i: number) => MARGIN.left + (i / n) * plotW

    // Grid
    ctx.strokeStyle = '#1e2836'
    ctx.lineWidth = 1
    const gridSteps = 5
    for (let g = 0; g <= gridSteps; g++) {
      const y = MARGIN.top + (g / gridSteps) * plotH
      ctx.beginPath()
      ctx.moveTo(MARGIN.left, y)
      ctx.lineTo(MARGIN.left + plotW, y)
      ctx.stroke()
      // dB label
      const db = maxP - (g / gridSteps) * (maxP - minP)
      ctx.fillStyle = '#4a5568'
      ctx.font = '9px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(isLog ? `${db.toFixed(0)}` : db.toFixed(2), MARGIN.left - 3, y + 3)
    }

    // Freq axis labels
    ctx.fillStyle = '#4a5568'
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    const freqLabels = [0, 0.25, 0.5, 0.75, 1.0]
    for (const frac of freqLabels) {
      const x = MARGIN.left + frac * plotW
      const hz = fftSettings.shift
        ? (frac - 0.5) * sampleRate
        : frac * sampleRate
      const label = Math.abs(hz) >= 1e6
        ? `${(hz / 1e6).toFixed(1)}M`
        : Math.abs(hz) >= 1e3
        ? `${(hz / 1e3).toFixed(0)}k`
        : `${hz.toFixed(0)}`
      ctx.fillText(label, x, MARGIN.top + plotH + 14)
    }

    // Max hold (faint)
    if (maxHoldRef.current && maxHoldRef.current.length === n) {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)'
      ctx.lineWidth = 1
      for (let i = 0; i < n; i++) {
        const x = toX(i)
        const y = toY(maxHoldRef.current[i])
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Average hold (slightly different color)
    if (avgHoldRef.current && avgHoldRef.current.length === n && realtimeSpectrumMode === 'average') {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < n; i++) {
        const x = toX(i)
        const y = toY(avgHoldRef.current[i])
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Instant trace
    const traceData = realtimeSpectrumMode === 'max' && maxHoldRef.current?.length === n
      ? maxHoldRef.current
      : realtimeSpectrumMode === 'average' && avgHoldRef.current?.length === n
      ? avgHoldRef.current
      : data

    ctx.beginPath()
    ctx.strokeStyle = '#4fc3f7'
    ctx.lineWidth = 1.5
    for (let i = 0; i < n; i++) {
      const x = toX(i)
      const y = toY(traceData[i])
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Fill under instant trace
    ctx.lineTo(toX(n - 1), MARGIN.top + plotH)
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH)
    ctx.closePath()
    ctx.fillStyle = 'rgba(79, 195, 247, 0.08)'
    ctx.fill()
  }, [isLog, fftSettings.shift, sampleRate, realtimeSpectrumMode])

  // Throttled FFT request: compute when playhead moves by >half-fftSize or on mode change
  useEffect(() => {
    if (!isPlaying && lastDataRef.current) {
      draw(lastDataRef.current)
      return
    }
    if (!isPlaying) return

    const threshold = fftSize / 2
    if (Math.abs(playheadSample - lastComputedSampleRef.current) < threshold) return
    if (pendingRef.current) return

    lastComputedSampleRef.current = playheadSample
    pendingRef.current = true

    window.snailAPI.computeFFT({
      startSample: playheadSample,
      length: fftSize,
      fftSize,
      window: fftSettings.window,
      shift: fftSettings.shift,
      scale: fftSettings.scale,
      sampleRate
    }).then((result) => {
      pendingRef.current = false
      if (!result?.data) return

      let data: Float32Array
      const raw = result.data as any
      data = raw instanceof Float32Array ? raw
        : raw instanceof ArrayBuffer ? new Float32Array(raw)
        : raw.buffer instanceof ArrayBuffer ? new Float32Array(raw.buffer)
        : new Float32Array(raw)

      lastDataRef.current = data

      // Update max hold
      if (!maxHoldRef.current || maxHoldRef.current.length !== data.length) {
        maxHoldRef.current = new Float32Array(data)
      } else {
        for (let i = 0; i < data.length; i++) {
          if (data[i] > maxHoldRef.current[i]) maxHoldRef.current[i] = data[i]
        }
      }

      // Update average hold (EMA)
      if (!avgHoldRef.current || avgHoldRef.current.length !== data.length) {
        avgHoldRef.current = new Float32Array(data)
      } else {
        for (let i = 0; i < data.length; i++) {
          avgHoldRef.current[i] = AVG_ALPHA * data[i] + (1 - AVG_ALPHA) * avgHoldRef.current[i]
        }
      }

      draw(data)
    }).catch(() => { pendingRef.current = false })
  }, [playheadSample, isPlaying, fftSize, fftSettings, sampleRate, realtimeSpectrumMode, draw])

  // Redraw when mode changes (to switch which trace is primary)
  useEffect(() => {
    if (lastDataRef.current) draw(lastDataRef.current)
  }, [realtimeSpectrumMode, draw])

  // ── Cursor readout ────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const handleMouseLeave = useCallback(() => setCursor(null), [])

  // Derive frequency + power from cursor position
  let cursorFreqLabel = ''
  let cursorPowerLabel = ''
  let cursorInPlot = false
  if (cursor && canvasRef.current) {
    const w = canvasRef.current.clientWidth
    const plotW = w - MARGIN.left - MARGIN.right
    const plotH = SPECTRUM_HEIGHT - MARGIN.top - MARGIN.bottom
    const px = cursor.x - MARGIN.left
    const py = cursor.y - MARGIN.top

    cursorInPlot = px >= 0 && px <= plotW && py >= 0 && py <= plotH

    if (px >= 0 && px <= plotW) {
      const frac = px / plotW
      const hz = fftSettings.shift ? (frac - 0.5) * sampleRate : frac * sampleRate
      const absHz = Math.abs(hz)
      if (absHz >= 1e9) cursorFreqLabel = `${(hz / 1e9).toFixed(4)} GHz`
      else if (absHz >= 1e6) cursorFreqLabel = `${(hz / 1e6).toFixed(4)} MHz`
      else if (absHz >= 1e3) cursorFreqLabel = `${(hz / 1e3).toFixed(2)} kHz`
      else cursorFreqLabel = `${hz.toFixed(0)} Hz`

      // Power at nearest bin
      const data = lastDataRef.current
      if (data && data.length > 0) {
        const binIdx = Math.max(0, Math.min(data.length - 1, Math.round(frac * data.length)))
        const p = data[binIdx]
        cursorPowerLabel = isLog ? `${p.toFixed(1)} dB` : p.toExponential(2)
      }
    }
  }

  if (!showRealtimeSpectrum) return null

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent)' : 'var(--bg3)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    color: active ? '#fff' : 'var(--text-muted)',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 11
  })

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: '#0a0e14',
      flexShrink: 0
    }}>
      {/* Controls strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)'
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 4 }}>Hold</span>
        <button style={btnStyle(realtimeSpectrumMode === 'instant')} onClick={() => setRealtimeSpectrumMode('instant')}>
          Instant
        </button>
        <button style={btnStyle(realtimeSpectrumMode === 'average')} onClick={() => setRealtimeSpectrumMode('average')}>
          Avg
        </button>
        <button style={btnStyle(realtimeSpectrumMode === 'max')} onClick={() => setRealtimeSpectrumMode('max')}>
          Max
        </button>
        <button
          style={{ ...btnStyle(false), marginLeft: 4 }}
          onClick={() => { clearHold(); if (lastDataRef.current) draw(lastDataRef.current) }}
        >
          Clear
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
          — max hold &nbsp; — avg hold &nbsp; — {realtimeSpectrumMode === 'instant' ? 'instant' : 'primary'}
        </span>
      </div>
      <div
        ref={wrapperRef}
        style={{ position: 'relative', width: '100%', height: SPECTRUM_HEIGHT, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: SPECTRUM_HEIGHT }}
        />

        {/* Cursor overlay — pointer-events:none so it doesn't block mouse */}
        {cursor && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute',
              left: cursor.x,
              top: MARGIN.top,
              height: SPECTRUM_HEIGHT - MARGIN.top - MARGIN.bottom,
              width: 1,
              background: 'rgba(255,255,255,0.55)',
              transform: 'translateX(-0.5px)'
            }} />

            {/* Horizontal line */}
            {cursorInPlot && (
              <div style={{
                position: 'absolute',
                left: MARGIN.left,
                top: cursor.y,
                width: (canvasRef.current?.clientWidth ?? 0) - MARGIN.left - MARGIN.right,
                height: 1,
                background: 'rgba(255,255,255,0.2)',
                transform: 'translateY(-0.5px)'
              }} />
            )}

            {/* Readout label */}
            {cursorFreqLabel && (() => {
              const canvasW = canvasRef.current?.clientWidth ?? 0
              const labelW = 150
              const flipX = cursor.x > canvasW - labelW - 10
              return (
                <div style={{
                  position: 'absolute',
                  left: flipX ? cursor.x - labelW - 6 : cursor.x + 6,
                  top: Math.max(MARGIN.top, Math.min(cursor.y - 9, SPECTRUM_HEIGHT - MARGIN.bottom - 32)),
                  background: 'rgba(10,14,20,0.92)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 3,
                  padding: '3px 7px',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.6,
                  whiteSpace: 'nowrap'
                }}>
                  <div style={{ color: '#e2e8f0' }}>{cursorFreqLabel}</div>
                  {cursorPowerLabel && (
                    <div style={{ color: '#718096' }}>{cursorPowerLabel}</div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
