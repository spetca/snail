import React, { useEffect, useRef, useCallback } from 'react'
import type { PulseRecord } from '../../shared/sample-formats'

interface Props {
  pulses: PulseRecord[]
  sampleRate: number
}

// ── Drawing utilities ──────────────────────────────────────────────────────

const BG   = '#0a0e14'
const GRID = '#1a2030'
const AXIS = '#2d3748'
const TEXT = '#5a6a7a'
const ACCENT = '#4fc3f7'

type Margin = { top: number; right: number; bottom: number; left: number }

function setupCanvas(canvas: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, w, h)
  return [ctx, w, h]
}

function drawGridAndAxes(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  m: Margin,
  xLabels: { pos: number; label: string }[],
  yLabels: { pos: number; label: string }[],
  title: string
) {
  const pw = w - m.left - m.right
  const ph = h - m.top - m.bottom

  // Grid lines
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  for (const { pos } of yLabels) {
    ctx.beginPath()
    ctx.moveTo(m.left, pos)
    ctx.lineTo(m.left + pw, pos)
    ctx.stroke()
  }
  for (const { pos } of xLabels) {
    ctx.beginPath()
    ctx.moveTo(pos, m.top)
    ctx.lineTo(pos, m.top + ph)
    ctx.stroke()
  }

  // Axes
  ctx.strokeStyle = AXIS
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(m.left, m.top)
  ctx.lineTo(m.left, m.top + ph)
  ctx.lineTo(m.left + pw, m.top + ph)
  ctx.stroke()

  // Labels
  ctx.fillStyle = TEXT
  ctx.font = '9px "JetBrains Mono", monospace'
  ctx.textAlign = 'right'
  for (const { pos, label } of yLabels) {
    ctx.fillText(label, m.left - 4, pos + 3)
  }
  ctx.textAlign = 'center'
  for (const { pos, label } of xLabels) {
    ctx.fillText(label, pos, m.top + ph + 13)
  }

  // Title
  ctx.fillStyle = '#3a4a5a'
  ctx.textAlign = 'left'
  ctx.font = '10px sans-serif'
  ctx.fillText(title, m.left + 2, m.top - 4)
}

function niceAxis(min: number, max: number, ticks: number) {
  if (min === max) { min -= 1; max += 1 }
  const range = max - min
  const step = Math.pow(10, Math.floor(Math.log10(range / ticks)))
  const rounded = [1, 2, 2.5, 5, 10].map(m => m * step)
  const niceStep = rounded.find(s => range / s <= ticks * 1.5) ?? step
  const lo = Math.floor(min / niceStep) * niceStep
  const hi = Math.ceil(max / niceStep) * niceStep
  const vals: number[] = []
  for (let v = lo; v <= hi + niceStep * 0.01; v += niceStep) vals.push(parseFloat(v.toFixed(10)))
  return vals
}

function freqColor(hz: number, allFreqs: number[]): string {
  // Map frequency to a distinct hue based on its rank in the sorted set
  const sorted = [...new Set(allFreqs.map(f => Math.round(f / 1e4) * 1e4))].sort((a, b) => a - b)
  const idx = sorted.findIndex(f => Math.abs(f - Math.round(hz / 1e4) * 1e4) < 1)
  const hue = (idx * 137.5) % 360 // golden angle for max separation
  return `hsl(${hue}, 80%, 60%)`
}

// ── Chart 1: Frequency vs Time ─────────────────────────────────────────────

function FreqTimePlot({ pulses }: { pulses: PulseRecord[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas || pulses.length === 0) return
    const [ctx, w, h] = setupCanvas(canvas)
    const m: Margin = { top: 22, right: 12, bottom: 28, left: 64 }
    const pw = w - m.left - m.right
    const ph = h - m.top - m.bottom

    const times = pulses.map(p => p.startTimeSecs)
    const freqs = pulses.map(p => p.centerFrequencyHz / 1e6)
    const tMin = Math.min(...times), tMax = Math.max(...times)
    const fMin = Math.min(...freqs), fMax = Math.max(...freqs)

    const tTicks = niceAxis(tMin, tMax, 5)
    const fTicks = niceAxis(fMin, fMax, 5)

    const toX = (t: number) => m.left + ((t - tMin) / (tMax - tMin || 1)) * pw
    const toY = (f: number) => m.top + ph - ((f - fMin) / (fMax - fMin || 1)) * ph

    const xLabels = tTicks.map(t => ({ pos: toX(t), label: t < 1 ? `${(t * 1e3).toFixed(0)}ms` : `${t.toFixed(2)}s` }))
    const yLabels = fTicks.map(f => ({ pos: toY(f), label: `${f.toFixed(2)}` }))

    drawGridAndAxes(ctx, w, h, m, xLabels, yLabels, 'Freq vs Time  (MHz)')

    const allFreqsHz = pulses.map(p => p.centerFrequencyHz)

    // Connect hops with thin lines
    ctx.strokeStyle = 'rgba(79,195,247,0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    pulses.forEach((p, i) => {
      const x = toX(p.startTimeSecs)
      const y = toY(p.centerFrequencyHz / 1e6)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Draw dots colored by frequency
    for (const p of pulses) {
      const x = toX(p.startTimeSecs)
      const y = toY(p.centerFrequencyHz / 1e6)
      ctx.fillStyle = freqColor(p.centerFrequencyHz, allFreqsHz)
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [pulses])

  useEffect(() => { draw() }, [draw])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ── Chart 2: PRI Timeline ──────────────────────────────────────────────────

function PRITimeline({ pulses }: { pulses: PulseRecord[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const [ctx, w, h] = setupCanvas(canvas)
    const m: Margin = { top: 22, right: 12, bottom: 28, left: 64 }
    const pw = w - m.left - m.right
    const ph = h - m.top - m.bottom

    const priPulses = pulses.filter(p => p.priSecs >= 0)
    if (priPulses.length === 0) {
      ctx.fillStyle = TEXT
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Need ≥ 2 pulses for PRI', w / 2, h / 2)
      return
    }

    const priUs = priPulses.map(p => p.priSecs * 1e6)
    const tStart = priPulses.map(p => p.startTimeSecs)
    const tMin = Math.min(...tStart), tMax = Math.max(...tStart)
    const pMin = Math.min(...priUs), pMax = Math.max(...priUs)
    const meanPri = priUs.reduce((a, b) => a + b, 0) / priUs.length

    const tTicks = niceAxis(tMin, tMax, 5)
    const pTicks = niceAxis(pMin, pMax, 5)

    const toX = (t: number) => m.left + ((t - tMin) / (tMax - tMin || 1)) * pw
    const toY = (p: number) => m.top + ph - ((p - pMin) / (pMax - pMin || 1)) * ph

    const xLabels = tTicks.map(t => ({ pos: toX(t), label: t < 1 ? `${(t * 1e3).toFixed(0)}ms` : `${t.toFixed(2)}s` }))
    const yLabels = pTicks.map(p => ({ pos: toY(p), label: `${p.toFixed(0)}` }))

    drawGridAndAxes(ctx, w, h, m, xLabels, yLabels, 'PRI vs Time  (µs)')

    // Mean PRI reference line
    const meanY = toY(meanPri)
    ctx.strokeStyle = 'rgba(255,193,7,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(m.left, meanY)
    ctx.lineTo(m.left + pw, meanY)
    ctx.stroke()
    ctx.setLineDash([])

    // Mean label
    ctx.fillStyle = 'rgba(255,193,7,0.7)'
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`μ=${meanPri.toFixed(1)}µs`, m.left + 3, meanY - 3)

    // PRI dots
    ctx.fillStyle = '#ffd54f'
    for (let i = 0; i < priPulses.length; i++) {
      const x = toX(priPulses[i].startTimeSecs)
      const y = toY(priUs[i])
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [pulses])

  useEffect(() => { draw() }, [draw])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ── Chart 3: Frequency Histogram ───────────────────────────────────────────

function FreqHistogram({ pulses }: { pulses: PulseRecord[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas || pulses.length === 0) return
    const [ctx, w, h] = setupCanvas(canvas)
    const m: Margin = { top: 22, right: 12, bottom: 28, left: 44 }
    const pw = w - m.left - m.right
    const ph = h - m.top - m.bottom

    const freqsMHz = pulses.map(p => p.centerFrequencyHz / 1e6)
    const fMin = Math.min(...freqsMHz), fMax = Math.max(...freqsMHz)

    // Bin into at most 24 bins, at least 1 bin per unique freq (rounded to 10kHz)
    const binWidthMHz = fMax === fMin ? 1 : (fMax - fMin) / Math.min(24, pulses.length)
    const numBins = fMax === fMin ? 1 : Math.ceil((fMax - fMin) / binWidthMHz) + 1
    const counts = new Array(numBins).fill(0)
    for (const f of freqsMHz) {
      const bi = Math.min(numBins - 1, Math.floor((f - fMin) / binWidthMHz))
      counts[bi]++
    }
    const maxCount = Math.max(...counts)

    const toX = (bi: number) => m.left + (bi / numBins) * pw
    const barW = Math.max(1, pw / numBins - 1)
    const toY = (c: number) => m.top + ph - (c / maxCount) * ph

    // Y axis labels (count)
    const cTicks = niceAxis(0, maxCount, 4)
    const xTicks = niceAxis(fMin, fMax, 5)
    const yLabels = cTicks.map(c => ({ pos: toY(c), label: `${Math.round(c)}` }))
    const xLabels = xTicks.map(f => ({ pos: m.left + ((f - fMin) / (fMax - fMin || 1)) * pw, label: `${f.toFixed(2)}` }))

    drawGridAndAxes(ctx, w, h, m, xLabels, yLabels, 'Freq Histogram  (MHz)')

    const allFreqsHz = pulses.map(p => p.centerFrequencyHz)

    for (let bi = 0; bi < numBins; bi++) {
      if (counts[bi] === 0) continue
      const x = toX(bi)
      const y = toY(counts[bi])
      const centerHz = (fMin + (bi + 0.5) * binWidthMHz) * 1e6
      ctx.fillStyle = freqColor(centerHz, allFreqsHz)
      ctx.fillRect(x, y, barW, m.top + ph - y)
    }
  }, [pulses])

  useEffect(() => { draw() }, [draw])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ── Chart 4: PRI Histogram ─────────────────────────────────────────────────

function PRIHistogram({ pulses }: { pulses: PulseRecord[] }) {
  const ref = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const [ctx, w, h] = setupCanvas(canvas)
    const m: Margin = { top: 22, right: 12, bottom: 28, left: 44 }
    const pw = w - m.left - m.right
    const ph = h - m.top - m.bottom

    const priPulses = pulses.filter(p => p.priSecs >= 0)
    if (priPulses.length === 0) {
      ctx.fillStyle = TEXT
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Need ≥ 2 pulses for PRI', w / 2, h / 2)
      return
    }

    const priUs = priPulses.map(p => p.priSecs * 1e6)
    const pMin = Math.min(...priUs), pMax = Math.max(...priUs)
    const numBins = Math.min(20, priPulses.length)
    const binW = pMax === pMin ? 1 : (pMax - pMin) / numBins
    const counts = new Array(numBins).fill(0)
    for (const p of priUs) {
      const bi = Math.min(numBins - 1, Math.floor((p - pMin) / (binW || 1)))
      counts[bi]++
    }
    const maxCount = Math.max(...counts)

    const cTicks = niceAxis(0, maxCount, 4)
    const pTicks = niceAxis(pMin, pMax, 5)
    const yLabels = cTicks.map(c => ({ pos: m.top + ph - (c / maxCount) * ph, label: `${Math.round(c)}` }))
    const xLabels = pTicks.map(p => ({
      pos: m.left + ((p - pMin) / (pMax - pMin || 1)) * pw,
      label: `${p.toFixed(0)}`
    }))

    drawGridAndAxes(ctx, w, h, m, xLabels, yLabels, 'PRI Histogram  (µs)')

    const barW = Math.max(1, pw / numBins - 1)
    for (let bi = 0; bi < numBins; bi++) {
      if (counts[bi] === 0) continue
      const x = m.left + (bi / numBins) * pw
      const y = m.top + ph - (counts[bi] / maxCount) * ph
      ctx.fillStyle = counts[bi] === maxCount ? '#ffd54f' : 'rgba(255,213,79,0.5)'
      ctx.fillRect(x, y, barW, m.top + ph - y)
    }
  }, [pulses])

  useEffect(() => { draw() }, [draw])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ── Stats strip ────────────────────────────────────────────────────────────

function StatsStrip({ pulses }: { pulses: PulseRecord[] }) {
  const priVals = pulses.filter(p => p.priSecs >= 0).map(p => p.priSecs * 1e6)
  const freqVals = pulses.map(p => p.centerFrequencyHz / 1e6)

  const meanPri = priVals.length ? priVals.reduce((a, b) => a + b, 0) / priVals.length : null
  const stdPri = priVals.length > 1
    ? Math.sqrt(priVals.reduce((s, v) => s + (v - meanPri!) ** 2, 0) / priVals.length)
    : null

  // Count distinct frequencies (rounded to nearest 50 kHz)
  const distinctFreqs = new Set(freqVals.map(f => Math.round(f * 20) / 20)).size

  const fMin = Math.min(...freqVals), fMax = Math.max(...freqVals)
  const hopSpanMHz = fMax - fMin

  const stat = (label: string, value: string) => (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{value}</span>
    </div>
  )

  return (
    <div style={{
      display: 'flex', gap: 24, padding: '8px 14px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg3)', flexShrink: 0, flexWrap: 'wrap'
    }}>
      {stat('Pulses', `${pulses.length}`)}
      {stat('Hop freqs ~', `${distinctFreqs}`)}
      {stat('Hop span', `${hopSpanMHz.toFixed(3)} MHz`)}
      {meanPri !== null && stat('Mean PRI', `${meanPri.toFixed(1)} µs`)}
      {stdPri !== null && stat('PRI σ', `${stdPri.toFixed(1)} µs`)}
      {meanPri !== null && stdPri !== null && stat('PRI CoV', `${((stdPri / meanPri) * 100).toFixed(1)}%`)}
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────

export function HopVisualizer({ pulses, sampleRate }: Props): React.ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      <StatsStrip pulses={pulses} />
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        background: 'var(--border)',
        overflow: 'hidden'
      }}>
        <div style={{ background: BG, overflow: 'hidden' }}><FreqTimePlot pulses={pulses} /></div>
        <div style={{ background: BG, overflow: 'hidden' }}><PRITimeline pulses={pulses} /></div>
        <div style={{ background: BG, overflow: 'hidden' }}><FreqHistogram pulses={pulses} /></div>
        <div style={{ background: BG, overflow: 'hidden' }}><PRIHistogram pulses={pulses} /></div>
      </div>
    </div>
  )
}
