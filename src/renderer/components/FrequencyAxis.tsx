import React, { useRef, useEffect } from 'react'
import { useStore } from '../state/store'
import { formatFrequency } from '../../shared/units'

const AXIS_WIDTH = 72

export function FrequencyAxis(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = AXIS_WIDTH * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${AXIS_WIDTH}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, AXIS_WIDTH, rect.height)

    const numTicks = 8
    const halfRate = sampleRate / 2
    const totalBins = fftSize / 2

    // Visible frequency range accounting for Y zoom/scroll
    // yScrollOffset is in bins, normalized: yOffset = yScrollOffset / totalBins
    const yOffset = yScrollOffset / totalBins
    const visibleFraction = 1 / yZoomLevel

    // Screen top (0) maps to freq at yOffset, screen bottom (1) maps to yOffset + visibleFraction
    // In the original: screen pos 0 = +halfRate, pos 1 = -halfRate
    // With zoom: screen pos t maps to normalized freq = yOffset + t * visibleFraction
    // Then freq = halfRate - normalizedFreq * sampleRate

    ctx.strokeStyle = '#2a3140'
    ctx.fillStyle = '#8890a0'
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'

    for (let i = 0; i <= numTicks; i++) {
      const y = (i / numTicks) * rect.height
      const normalizedPos = yOffset + (i / numTicks) * visibleFraction
      const freq = halfRate - normalizedPos * sampleRate

      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(6, y)
      ctx.stroke()

      ctx.fillText(formatFrequency(freq), 10, y + 4)
    }
  }, [sampleRate, fftSize, yZoomLevel, yScrollOffset])

  return (
    <div
      ref={containerRef}
      style={{
        width: AXIS_WIDTH,
        background: 'var(--bg2)',
        borderLeft: '1px solid var(--border)'
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
