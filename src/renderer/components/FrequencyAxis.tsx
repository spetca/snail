import React, { useRef, useEffect } from 'react'
import { useStore } from '../state/store'
import { formatFrequency } from '../../shared/units'

const AXIS_WIDTH = 72

export function FrequencyAxis(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const sampleRate = useStore((s) => s.sampleRate)

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

    ctx.strokeStyle = '#2a3140'
    ctx.fillStyle = '#8890a0'
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'

    for (let i = 0; i <= numTicks; i++) {
      const y = (i / numTicks) * rect.height
      // Frequency: top = +sampleRate/2, bottom = -sampleRate/2
      const freq = halfRate - (i / numTicks) * sampleRate

      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(6, y)
      ctx.stroke()

      ctx.fillText(formatFrequency(freq), 10, y + 4)
    }
  }, [sampleRate])

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
