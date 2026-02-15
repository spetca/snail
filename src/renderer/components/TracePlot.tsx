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
    const stride = Math.max(1, Math.round(samplesPerPixel))
    const start = scrollOffset

    // We request enough valid samples to fill the screen width
    // If stride > 1, we get 1 sample per pixel (approx)
    // If stride == 1, we get samplesPerPixel samples per pixel
    const samplesToRequest = stride > 1
      ? Math.ceil(rect.width) + 2
      : Math.ceil(rect.width * samplesPerPixel)

    // Load samples and draw
    window.snailAPI.getSamples(start, samplesToRequest, stride)
      .then((samples) => {
        if (!samples || samples.length === 0) return

        const midY = TRACE_HEIGHT / 2
        const scale = TRACE_HEIGHT / 4

        // I channel (red)
        ctx.strokeStyle = '#ff6b6b'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px < rect.width; px++) {
          let i: number
          if (stride > 1) {
            // Decimated: 1 sample matches 1 pixel (approx)
            i = px
          } else {
            // Full res: map pixel to sample index
            i = Math.floor(px * samplesPerPixel)
          }

          const sampleIdx = i * 2 // complex interleaved
          if (sampleIdx >= samples.length) break

          const val = samples[sampleIdx]
          const y = midY - val * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Q channel (blue)
        ctx.strokeStyle = '#4dabf7'
        ctx.beginPath()
        for (let px = 0; px < rect.width; px++) {
          let i: number
          if (stride > 1) {
            i = px
          } else {
            i = Math.floor(px * samplesPerPixel)
          }

          const sampleIdx = i * 2 + 1
          if (sampleIdx >= samples.length) break

          const val = samples[sampleIdx]
          const y = midY - val * scale
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
