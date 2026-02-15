import React, { useRef, useEffect } from 'react'
import { useStore } from '../state/store'

const TRACE_HEIGHT = 100

export function TracePlot(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fileInfo = useStore((s) => s.fileInfo)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const cursors = useStore((s) => s.cursors)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !fileInfo) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = TRACE_HEIGHT * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${TRACE_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, TRACE_HEIGHT)

    // Background
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, rect.width, TRACE_HEIGHT)

    const samplesPerPixel = fftSize / zoomLevel
    const numSamples = Math.ceil(rect.width * samplesPerPixel)
    const start = scrollOffset

    // Load samples and draw
    window.snailAPI.getSamples(start, Math.min(numSamples, fileInfo.totalSamples - start))
      .then((samples) => {
        if (!samples || samples.length === 0) return

        const midY = TRACE_HEIGHT / 2
        const scale = TRACE_HEIGHT / 4

        // I channel (red)
        ctx.strokeStyle = '#ff6b6b'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px < rect.width; px++) {
          const sampleIdx = Math.floor(px * samplesPerPixel) * 2 // complex: I at even indices
          if (sampleIdx >= samples.length) break
          const y = midY - samples[sampleIdx] * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Q channel (blue)
        ctx.strokeStyle = '#4dabf7'
        ctx.beginPath()
        for (let px = 0; px < rect.width; px++) {
          const sampleIdx = Math.floor(px * samplesPerPixel) * 2 + 1 // complex: Q at odd indices
          if (sampleIdx >= samples.length) break
          const y = midY - samples[sampleIdx] * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Cursor selection highlight
        if (cursors.enabled && cursors.x1 !== cursors.x2) {
          const left = Math.min(cursors.x1, cursors.x2)
          const right = Math.max(cursors.x1, cursors.x2)
          ctx.fillStyle = 'rgba(0, 212, 170, 0.15)'
          ctx.fillRect(left, 0, right - left, TRACE_HEIGHT)
          ctx.strokeStyle = 'rgba(0, 212, 170, 0.4)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(left, 0); ctx.lineTo(left, TRACE_HEIGHT)
          ctx.moveTo(right, 0); ctx.lineTo(right, TRACE_HEIGHT)
          ctx.stroke()
        }

        // Labels
        ctx.font = '10px "JetBrains Mono", monospace'
        ctx.fillStyle = '#ff6b6b'
        ctx.fillText('I', 6, 14)
        ctx.fillStyle = '#4dabf7'
        ctx.fillText('Q', 6, 28)
      })
      .catch(() => {
        // Silently fail if native addon not ready
      })
  }, [fileInfo, scrollOffset, fftSize, zoomLevel, cursors])

  return (
    <div
      ref={containerRef}
      style={{
        height: TRACE_HEIGHT,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg1)',
        marginRight: 72
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
