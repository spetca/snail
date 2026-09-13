import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { spectralNoiseDb } from '../../shared/spectral-power'
import { formatTimeValue } from '../../shared/units'

interface PowerPoint { peak: number; noise: number }

/** Sample FFT windows along the same time axis as the spectrogram. */
export function PowerTrace({ width, height }: { width: number; height: number }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInfo = useStore(s => s.fileInfo)
  const scrollOffset = useStore(s => s.scrollOffset)
  const viewFFT = useStore(s => s.fftSize)
  const zoomLevel = useStore(s => s.zoomLevel)
  const yZoom = useStore(s => s.yZoomLevel)
  const yScroll = useStore(s => s.yScrollOffset)
  const config = useStore(s => s.detectionConfig)
  const [points, setPoints] = useState<PowerPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const stride = Math.max(1, Math.round(viewFFT / zoomLevel))
  const n = config.fftSize
  const low = Math.max(-0.5, 0.5 - yScroll / (viewFFT / 2) - 1 / yZoom)
  const high = Math.min(0.5, 0.5 - yScroll / (viewFFT / 2))
  const first = Math.max(0, Math.ceil((low + 0.5) * n))
  const last = Math.min(n - 1, Math.floor((high + 0.5) * n))

  useEffect(() => {
    let cancelled = false
    setPoints([]); setHover(null); setError(null)
    if (!fileInfo || width <= 0) return
    if (last < first) { setLoading(false); setError('No FFT bins in view. Increase detection FFT size or zoom out.'); return }
    setLoading(true)
    void (async () => {
      const result: PowerPoint[] = []
      const count = Math.min(Math.ceil(width), Math.ceil((fileInfo.totalSamples - scrollOffset) / stride))
      for (let column = 0; column < count; column += 256) {
        const tile = await window.snailAPI.computeFFTTile({ recordingId: fileInfo.recordingId,
          startSample: scrollOffset + column * stride, fftSize: n, stride })
        if (cancelled) return
        const rows = Math.min(256, count - column)
        if (tile.length < rows * n) throw new Error('Incomplete FFT data for power trace')
        for (let rowIndex = 0; rowIndex < rows; ++rowIndex) {
          const row = tile.subarray(rowIndex * n, (rowIndex + 1) * n)
          if (row.some(value => !Number.isFinite(value))) throw new Error('Invalid FFT power data')
          let peak = -Infinity
          for (let bin = first; bin <= last; ++bin) peak = Math.max(peak, row[bin])
          result.push({ peak, noise: spectralNoiseDb(row, first, last) })
        }
      }
      if (!cancelled) setPoints(result)
    })().catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fileInfo, width, scrollOffset, stride, n, first, last])

  const absolute = config.thresholdMode === 'absolute'
  const thresholdFor = (point: PowerPoint) => absolute ? config.minimumPowerDb : Math.max(config.minimumPowerDb, point.noise + config.thresholdDb)
  let minimum = absolute ? config.minimumPowerDb : Infinity
  let maximum = absolute ? config.minimumPowerDb : -Infinity
  for (const point of points) {
    minimum = Math.min(minimum, point.noise, point.peak, thresholdFor(point))
    maximum = Math.max(maximum, point.peak, thresholdFor(point))
  }
  const bottomDb = Number.isFinite(minimum) ? Math.floor((minimum - 5) / 10) * 10 : -120
  const topDb = Number.isFinite(maximum) ? Math.max(bottomDb + 20, Math.ceil((maximum + 5) / 10) * 10) : 0
  const powerAtY = (y: number) => topDb - Math.max(0, Math.min(1, (y - 8) / (height - 16))) * (topDb - bottomDb)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr); canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, width, height)
    const toY = (value: number) => 8 + (topDb - value) / (topDb - bottomDb) * (height - 16)
    ctx.font = '10px monospace'
    for (let i = 0; i <= 4; ++i) {
      const value = topDb - i * (topDb - bottomDb) / 4, y = toY(value)
      ctx.strokeStyle = '#26313e'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      ctx.fillStyle = '#a2adbb'; ctx.fillText(`${value.toFixed(0)} dB`, 4, y - 2)
    }
    const line = (color: string, value: (p: PowerPoint) => number, dashed = false) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dashed ? [5, 3] : []); ctx.beginPath()
      points.forEach((point, x) => x ? ctx.lineTo(x, toY(value(point))) : ctx.moveTo(x, toY(value(point))))
      ctx.stroke(); ctx.setLineDash([])
    }
    line('#718096', p => p.noise)
    line('#00d4aa', p => p.peak)
    line('#ffb454', p => thresholdFor(p), true)
    if (hover) {
      ctx.strokeStyle = '#ffffff66'; ctx.beginPath()
      ctx.moveTo(hover.x, 0); ctx.lineTo(hover.x, height)
      ctx.moveTo(0, hover.y); ctx.lineTo(width, hover.y); ctx.stroke()
    }
  }, [points, width, height, topDb, bottomDb, absolute, config.minimumPowerDb, config.thresholdDb, hover])

  const point = hover ? points[Math.floor(hover.x)] : undefined
  return <div aria-label="Absolute power trace">
    <div style={{ fontSize: 10, padding: '2px 6px', color: 'var(--text-muted)' }}>
      <span style={{ color: '#00d4aa' }}>Peak bin</span> · <span>Noise</span> · <span style={{ color: '#ffb454' }}>{absolute ? `Threshold ${config.minimumPowerDb.toFixed(1)} dB` : `Threshold +${config.thresholdDb} dB`}</span> · FFT {n}
      <span title="Native Hann FFT bin power, matching the detector. Not calibrated dBm. One FFT window per screen column; zoom in to inspect short bursts."> · sampled dB ⓘ</span>
    </div>
    <canvas aria-label="Power over time; click to set absolute detection threshold" ref={canvasRef}
      style={{ width, height, display: 'block', cursor: 'crosshair' }}
      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
      onMouseLeave={() => setHover(null)}
      onClick={e => {
        if (!points.length || loading) return
        const value = powerAtY(e.clientY - e.currentTarget.getBoundingClientRect().top)
        useStore.setState({ detectionConfig: { ...config, thresholdMode: 'absolute', minimumPowerDb: Math.max(-200, Math.min(0, Math.round(value * 10) / 10)) } })
      }} />
    <div role="status" style={{ minHeight: 16, fontSize: 10, padding: '2px 6px', color: error ? 'var(--error)' : 'var(--text-muted)' }}>
      {error ?? (loading ? 'Loading power…' : point && hover
        ? `${formatTimeValue((scrollOffset + Math.floor(hover.x) * stride) / (fileInfo?.sampleRate ?? 1))} · peak ${point.peak.toFixed(1)} dB · noise ${point.noise.toFixed(1)} dB · click to set ${Math.max(-200, Math.min(0, powerAtY(hover.y))).toFixed(1)} dB`
        : 'Visible frequency band · click a power level to set the absolute detection threshold.')}
    </div>
  </div>
}
