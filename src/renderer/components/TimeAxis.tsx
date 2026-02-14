import React, { useRef, useEffect } from 'react'
import { useStore } from '../state/store'
import { formatTimeValue } from '../../shared/units'

const AXIS_HEIGHT = 32

export function TimeAxis(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const sampleRate = useStore((s) => s.sampleRate)
  const xAxisMode = useStore((s) => s.xAxisMode)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = AXIS_HEIGHT * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${AXIS_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, AXIS_HEIGHT)

    const samplesPerPixel = fftSize / zoomLevel
    const totalPixels = rect.width

    // Compute nice tick spacing
    const minTickSpacing = 80
    const sampleRange = totalPixels * samplesPerPixel

    let tickInterval: number
    if (xAxisMode === 'time') {
      const timeRange = sampleRange / sampleRate
      const minTickTime = (minTickSpacing / totalPixels) * timeRange
      tickInterval = niceNumber(minTickTime) * sampleRate
    } else {
      const minTickSamples = (minTickSpacing / totalPixels) * sampleRange
      tickInterval = niceNumber(minTickSamples)
    }

    if (tickInterval <= 0) return

    const startSample = scrollOffset
    const firstTick = Math.ceil(startSample / tickInterval) * tickInterval

    ctx.strokeStyle = '#2a3140'
    ctx.fillStyle = '#8890a0'
    ctx.font = '11px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'

    for (let sample = firstTick; ; sample += tickInterval) {
      const px = (sample - startSample) / samplesPerPixel
      if (px > totalPixels) break

      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, 6)
      ctx.stroke()

      let label: string
      if (xAxisMode === 'time') {
        label = formatTimeValue(sample / sampleRate)
      } else {
        label = formatSampleLabel(sample)
      }

      ctx.fillText(label, px, 22)
    }
  }, [scrollOffset, fftSize, zoomLevel, sampleRate, xAxisMode])

  return (
    <div ref={containerRef} style={{ height: AXIS_HEIGHT, background: 'var(--bg2)', borderTop: '1px solid var(--border)', marginRight: 72 }}>
      <canvas ref={canvasRef} />
    </div>
  )
}

function niceNumber(value: number): number {
  const exp = Math.floor(Math.log10(value))
  const frac = value / Math.pow(10, exp)
  let nice: number
  if (frac <= 1.5) nice = 1
  else if (frac <= 3.5) nice = 2
  else if (frac <= 7.5) nice = 5
  else nice = 10
  return nice * Math.pow(10, exp)
}

function formatSampleLabel(sample: number): string {
  if (sample >= 1e6) return `${(sample / 1e6).toFixed(1)}M`
  if (sample >= 1e3) return `${(sample / 1e3).toFixed(1)}k`
  return `${sample}`
}
