import React, { useRef, useEffect } from 'react'
import { useStore } from '../state/store'

const PLOT_HEIGHT = 80

export function CorrelationPlot(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const correlationData = useStore((s) => s.correlationData)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !correlationData) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = PLOT_HEIGHT * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${PLOT_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, PLOT_HEIGHT)

    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, rect.width, PLOT_HEIGHT)

    // Find max magnitude for normalization
    let maxVal = 0
    for (let i = 0; i < correlationData.length; i++) {
      if (correlationData[i] > maxVal) maxVal = correlationData[i]
    }
    if (maxVal === 0) return

    const samplesPerPixel = fftSize / zoomLevel

    // Draw correlation trace
    ctx.strokeStyle = '#00e5a0'
    ctx.lineWidth = 1
    ctx.beginPath()

    for (let px = 0; px < rect.width; px++) {
      const sampleIdx = Math.floor(scrollOffset + px * samplesPerPixel)
      if (sampleIdx >= correlationData.length) break

      const normalized = correlationData[sampleIdx] / maxVal
      const y = PLOT_HEIGHT - normalized * (PLOT_HEIGHT - 4)

      if (px === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()

    // Label
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#00e5a0'
    ctx.fillText('Correlation', 6, 14)
  }, [correlationData, scrollOffset, fftSize, zoomLevel])

  return (
    <div
      ref={containerRef}
      style={{
        height: PLOT_HEIGHT,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg1)'
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
