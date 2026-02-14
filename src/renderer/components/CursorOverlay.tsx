import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../state/store'
import { formatTimeValue, formatFrequency } from '../../shared/units'

const GRAB_THRESHOLD = 10

type DragTarget = 'x1' | 'x2' | 'y1' | 'y2' | 'all' | null

export function CursorOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragTarget>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const cursors = useStore((s) => s.cursors)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const xAxisMode = useStore((s) => s.xAxisMode)
  const setCursorX = useStore((s) => s.setCursorX)
  const setCursorY = useStore((s) => s.setCursorY)

  // Draw cursors
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !cursors.enabled) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const { x1, x2, y1, y2 } = cursors

    // Selection fill
    if (x1 !== x2 && y1 !== y2) {
      ctx.fillStyle = 'rgba(0, 212, 170, 0.08)'
      ctx.fillRect(
        Math.min(x1, x2), Math.min(y1, y2),
        Math.abs(x2 - x1), Math.abs(y2 - y1)
      )
    }

    // Vertical cursors (solid)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    for (const x of [x1, x2]) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rect.height)
      ctx.stroke()
    }

    // Horizontal cursors (dashed)
    ctx.setLineDash([4, 4])
    for (const y of [y1, y2]) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(rect.width, y)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Measurements label
    const samplesPerPixel = fftSize / zoomLevel
    const sampleDelta = Math.abs(x2 - x1) * samplesPerPixel
    const timeDelta = sampleDelta / sampleRate

    const freqTop = (0.5 - Math.min(y1, y2) / rect.height) * sampleRate
    const freqBot = (0.5 - Math.max(y1, y2) / rect.height) * sampleRate
    const bandwidth = Math.abs(freqTop - freqBot)

    ctx.font = '11px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    const labelX = Math.max(x1, x2) + 8
    const labelY = Math.min(y1, y2) - 8

    const labels = [
      xAxisMode === 'time'
        ? `\u0394t: ${formatTimeValue(timeDelta)}`
        : `\u0394n: ${Math.round(sampleDelta)}`,
      `BW: ${formatFrequency(bandwidth)}`
    ]

    labels.forEach((label, i) => {
      const textWidth = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(labelX - 2, labelY + i * 16 - 11, textWidth + 4, 14)
      ctx.fillStyle = '#00d4aa'
      ctx.fillText(label, labelX, labelY + i * 16)
    })
  }, [cursors, fftSize, zoomLevel, sampleRate, scrollOffset, xAxisMode])

  const findTarget = useCallback((x: number, y: number): DragTarget => {
    const { x1, x2, y1, y2 } = cursors
    if (Math.abs(x - x1) < GRAB_THRESHOLD) return 'x1'
    if (Math.abs(x - x2) < GRAB_THRESHOLD) return 'x2'
    if (Math.abs(y - y1) < GRAB_THRESHOLD) return 'y1'
    if (Math.abs(y - y2) < GRAB_THRESHOLD) return 'y2'

    // Inside selection?
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) return 'all'

    return null
  }, [cursors])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!cursors.enabled) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const target = findTarget(x, y)
    if (target) {
      setDragging(target)
      setDragStart({ x, y })
    } else {
      // Start new selection
      setCursorX(x, x)
      setCursorY(y, y)
      setDragging('x2')
      setDragStart({ x, y })
    }
  }, [cursors.enabled, findTarget, setCursorX, setCursorY])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const dx = x - dragStart.x
    const dy = y - dragStart.y

    switch (dragging) {
      case 'x1': setCursorX(x, cursors.x2); break
      case 'x2': setCursorX(cursors.x1, x); break
      case 'y1': setCursorY(y, cursors.y2); break
      case 'y2': setCursorY(cursors.y1, y); break
      case 'all':
        setCursorX(cursors.x1 + dx, cursors.x2 + dx)
        setCursorY(cursors.y1 + dy, cursors.y2 + dy)
        setDragStart({ x, y })
        break
    }
  }, [dragging, dragStart, cursors, setCursorX, setCursorY])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  if (!cursors.enabled) return <></>

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        cursor: dragging ? 'grabbing' : 'crosshair',
        zIndex: 10
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
