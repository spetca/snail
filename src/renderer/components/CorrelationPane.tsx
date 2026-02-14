import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../state/store'

const SIGNAL_HEIGHT = 120
const TRACE_HEIGHT = 80
const PANE_HEIGHT = SIGNAL_HEIGHT + TRACE_HEIGHT

export function CorrelationPane(): React.ReactElement {
  const signalCanvasRef = useRef<HTMLCanvasElement>(null)
  const traceCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [dragStartX, setDragStartX] = useState(0)
  const [dragStartLag, setDragStartLag] = useState(0)

  const correlationData = useStore((s) => s.correlationData)
  const correlationStartSample = useStore((s) => s.correlationStartSample)
  const correlationLag = useStore((s) => s.correlationLag)
  const setCorrelationLag = useStore((s) => s.setCorrelationLag)
  const setCorrelationPaneVisible = useStore((s) => s.setCorrelationPaneVisible)
  const fileInfo = useStore((s) => s.fileInfo)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)

  const getContainerWidth = useCallback((): number => {
    return containerRef.current?.getBoundingClientRect().width ?? 800
  }, [])

  // Draw signal overlay (top panel)
  useEffect(() => {
    const canvas = signalCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !fileInfo || !correlationData) return

    const rect = container.getBoundingClientRect()
    const width = rect.width
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = SIGNAL_HEIGHT * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${SIGNAL_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, SIGNAL_HEIGHT)
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, width, SIGNAL_HEIGHT)

    const samplesPerPixel = fftSize / zoomLevel
    const viewSamples = Math.ceil(width * samplesPerPixel)
    const start = correlationStartSample

    // Load and draw main signal + template overlay
    window.snailAPI.getSamples(start, Math.min(viewSamples, fileInfo.totalSamples - start))
      .then((samples) => {
        if (!samples || samples.length === 0) return

        const midY = SIGNAL_HEIGHT / 2
        const scale = SIGNAL_HEIGHT / 4

        // Main signal magnitude (white/gray)
        ctx.strokeStyle = 'rgba(200, 200, 200, 0.6)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px < width; px++) {
          const idx = Math.floor(px * samplesPerPixel) * 2
          if (idx + 1 >= samples.length) break
          const mag = Math.sqrt(samples[idx] ** 2 + samples[idx + 1] ** 2)
          const y = midY - mag * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Template overlay (cyan), shifted by correlationLag
        const lagOffset = correlationLag
        ctx.strokeStyle = '#00e5ff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        let started = false
        for (let px = 0; px < width; px++) {
          const sampleIdx = Math.floor(px * samplesPerPixel) - lagOffset
          const idx = sampleIdx * 2
          if (idx < 0 || idx + 1 >= samples.length) continue
          const mag = Math.sqrt(samples[idx] ** 2 + samples[idx + 1] ** 2)
          const y = midY - mag * scale
          if (!started) { ctx.moveTo(px, y); started = true }
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Labels
        ctx.font = '10px "JetBrains Mono", monospace'
        ctx.fillStyle = 'rgba(200, 200, 200, 0.6)'
        ctx.fillText('Signal', 6, 14)
        ctx.fillStyle = '#00e5ff'
        ctx.fillText(`Template (lag: ${correlationLag})`, 6, 28)

        // Drag hint
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.fillText('Drag to slide template', width - 160, 14)
      })
      .catch(() => {})
  }, [correlationData, correlationStartSample, correlationLag, fileInfo, fftSize, zoomLevel])

  // Draw correlation trace (bottom panel)
  useEffect(() => {
    const canvas = traceCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !correlationData) return

    const rect = container.getBoundingClientRect()
    const width = rect.width
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = TRACE_HEIGHT * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${TRACE_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, TRACE_HEIGHT)
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, width, TRACE_HEIGHT)

    // Find max for normalization
    let maxVal = 0
    for (let i = 0; i < correlationData.length; i++) {
      if (correlationData[i] > maxVal) maxVal = correlationData[i]
    }
    if (maxVal === 0) return

    const totalLags = correlationData.length

    // Draw trace — map full correlation data to canvas width
    ctx.strokeStyle = '#00e5a0'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let px = 0; px < width; px++) {
      const lagIdx = Math.floor((px / width) * totalLags)
      if (lagIdx >= totalLags) break
      const normalized = correlationData[lagIdx] / maxVal
      const y = TRACE_HEIGHT - normalized * (TRACE_HEIGHT - 4)
      if (px === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()

    // Current lag marker
    const markerX = (correlationLag / totalLags) * width
    ctx.strokeStyle = '#FFD700'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(markerX, 0)
    ctx.lineTo(markerX, TRACE_HEIGHT)
    ctx.stroke()

    // Labels
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#00e5a0'
    ctx.fillText('Correlation', 6, 14)
    ctx.fillStyle = '#FFD700'
    ctx.fillText(`Lag: ${correlationLag}`, 6, 28)
  }, [correlationData, correlationLag])

  // Signal panel drag handlers (slide template)
  const handleSignalMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true)
    setDragStartX(e.clientX)
    setDragStartLag(correlationLag)
  }, [correlationLag])

  const handleSignalMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !correlationData) return
    const samplesPerPixel = fftSize / zoomLevel
    const dx = e.clientX - dragStartX
    const lagDelta = Math.round(dx * samplesPerPixel)
    const newLag = Math.max(0, Math.min(correlationData.length - 1, dragStartLag + lagDelta))
    setCorrelationLag(newLag)
  }, [dragging, dragStartX, dragStartLag, correlationData, fftSize, zoomLevel, setCorrelationLag])

  const handleSignalMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  // Trace panel click handler (jump to lag)
  const handleTraceClick = useCallback((e: React.MouseEvent) => {
    if (!correlationData) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const lagIdx = Math.round((x / rect.width) * correlationData.length)
    setCorrelationLag(Math.max(0, Math.min(correlationData.length - 1, lagIdx)))
  }, [correlationData, setCorrelationLag])

  const handleClose = useCallback(() => {
    setCorrelationPaneVisible(false)
  }, [setCorrelationPaneVisible])

  if (!correlationData) return <></>

  return (
    <div
      ref={containerRef}
      style={{
        height: PANE_HEIGHT,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg1)',
        position: 'relative',
        marginRight: 72,
        flexShrink: 0
      }}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          zIndex: 2,
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          lineHeight: 1,
          padding: 0
        }}
      >
        x
      </button>

      {/* Signal overlay panel */}
      <div
        style={{
          height: SIGNAL_HEIGHT,
          cursor: dragging ? 'grabbing' : 'grab',
          borderBottom: '1px solid var(--border)'
        }}
        onMouseDown={handleSignalMouseDown}
        onMouseMove={handleSignalMouseMove}
        onMouseUp={handleSignalMouseUp}
        onMouseLeave={handleSignalMouseUp}
      >
        <canvas ref={signalCanvasRef} />
      </div>

      {/* Correlation trace panel */}
      <div
        style={{
          height: TRACE_HEIGHT,
          cursor: 'crosshair'
        }}
        onClick={handleTraceClick}
      >
        <canvas ref={traceCanvasRef} />
      </div>
    </div>
  )
}
