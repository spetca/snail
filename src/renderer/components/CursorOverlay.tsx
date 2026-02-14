import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../state/store'
import { formatTimeValue, formatFrequency } from '../../shared/units'

const GRAB_THRESHOLD = 10
const TRI_W = 16
const TRI_H = 12
const TRI_COLOR = '#FFD700'
const TRI_HOVER = '#FFE44D'

const ANNOTATION_COLORS = ['#FF6B6B', '#4DABF7', '#51CF66', '#FFD43B', '#CC5DE8', '#FF922B']

type DragTarget = 'x1' | 'x2' | 'y1' | 'y2' | 'all' | null

export function CursorOverlay(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragTarget>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hoverTarget, setHoverTarget] = useState<DragTarget>(null)

  const cursors = useStore((s) => s.cursors)
  const annotations = useStore((s) => s.annotations)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const xAxisMode = useStore((s) => s.xAxisMode)
  const setCursorX = useStore((s) => s.setCursorX)
  const setCursorY = useStore((s) => s.setCursorY)

  // Draw cursors
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const hasContent = cursors.enabled || annotations.length > 0
    if (!canvas || !container || !hasContent) return

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

    // Draw annotations
    const samplesPerPx = fftSize / zoomLevel
    const totalBins = fftSize / 2
    const visibleBins = totalBins / yZoomLevel
    const yScrollBins = yScrollOffset / totalBins // normalized

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i]
      const color = ANNOTATION_COLORS[i % ANNOTATION_COLORS.length]

      const ax1 = (ann.sampleStart - scrollOffset) / samplesPerPx
      const ax2 = (ann.sampleStart + ann.sampleCount - scrollOffset) / samplesPerPx

      let ay1: number, ay2: number
      if (ann.freqLowerEdge != null && ann.freqUpperEdge != null) {
        // Map frequency to pixel Y: freq -> normalized bin -> pixel
        // DC is center. Top of view = +sampleRate/2, bottom = -sampleRate/2
        // Normalized position: (0.5 - freq/sampleRate) maps to [0, 1] for full range
        const normTop = 0.5 - ann.freqUpperEdge / sampleRate
        const normBot = 0.5 - ann.freqLowerEdge / sampleRate
        // Apply Y zoom/scroll
        ay1 = ((normTop - yScrollBins) * yZoomLevel) * rect.height
        ay2 = ((normBot - yScrollBins) * yZoomLevel) * rect.height
      } else {
        ay1 = 0
        ay2 = rect.height
      }

      // Clip to visible area
      const drawX1 = Math.max(0, ax1)
      const drawX2 = Math.min(rect.width, ax2)
      const drawY1 = Math.max(0, Math.min(ay1, ay2))
      const drawY2 = Math.min(rect.height, Math.max(ay1, ay2))

      if (drawX2 <= drawX1) continue

      // Semi-transparent fill
      ctx.fillStyle = color + '33'
      ctx.fillRect(drawX1, drawY1, drawX2 - drawX1, drawY2 - drawY1)

      // Border
      ctx.strokeStyle = color + 'AA'
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.strokeRect(drawX1, drawY1, drawX2 - drawX1, drawY2 - drawY1)

      // Label
      if (ann.label && drawX2 - drawX1 > 10) {
        ctx.font = '10px "JetBrains Mono", monospace'
        const textWidth = ctx.measureText(ann.label).width
        const labelPadX = 4
        const labelPadY = 2
        const labelH = 14
        const lx = drawX1 + 2
        const ly = drawY1 + 2

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
        ctx.fillRect(lx, ly, textWidth + labelPadX * 2, labelH + labelPadY)
        ctx.fillStyle = color
        ctx.fillText(ann.label, lx + labelPadX, ly + labelH - labelPadY)
      }
    }

    if (cursors.enabled) {
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

    // Draw yellow triangle grabbers on top

    // X cursors: downward-pointing triangles at top edge
    for (const [key, x] of [['x1', x1], ['x2', x2]] as const) {
      const isHovered = hoverTarget === key
      ctx.fillStyle = isHovered ? TRI_HOVER : TRI_COLOR
      ctx.beginPath()
      ctx.moveTo(x - TRI_W / 2, 0)
      ctx.lineTo(x + TRI_W / 2, 0)
      ctx.lineTo(x, TRI_H)
      ctx.closePath()
      ctx.fill()
    }

    // Y cursors: left-pointing triangles at right edge
    for (const [key, y] of [['y1', y1], ['y2', y2]] as const) {
      const isHovered = hoverTarget === key
      ctx.fillStyle = isHovered ? TRI_HOVER : TRI_COLOR
      ctx.beginPath()
      ctx.moveTo(rect.width, y - TRI_W / 2)
      ctx.lineTo(rect.width, y + TRI_W / 2)
      ctx.lineTo(rect.width - TRI_H, y)
      ctx.closePath()
      ctx.fill()
    }
    } // end if (cursors.enabled)
  }, [cursors, annotations, fftSize, zoomLevel, sampleRate, scrollOffset, xAxisMode, yZoomLevel, yScrollOffset, hoverTarget])

  const hitTestTriangle = useCallback((mx: number, my: number): DragTarget => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const { x1, x2, y1, y2 } = cursors

    // X cursor triangles (top edge, downward-pointing)
    for (const [key, x] of [['x1', x1], ['x2', x2]] as const) {
      if (mx >= x - TRI_W / 2 && mx <= x + TRI_W / 2 && my >= 0 && my <= TRI_H) {
        return key
      }
    }

    // Y cursor triangles (right edge, left-pointing)
    for (const [key, y] of [['y1', y1], ['y2', y2]] as const) {
      if (mx >= rect.width - TRI_H && mx <= rect.width && my >= y - TRI_W / 2 && my <= y + TRI_W / 2) {
        return key
      }
    }

    return null
  }, [cursors])

  const findTarget = useCallback((x: number, y: number): DragTarget => {
    // Check triangles first (easier to grab)
    const triTarget = hitTestTriangle(x, y)
    if (triTarget) return triTarget

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
  }, [cursors, hitTestTriangle])

  const getCursor = useCallback((target: DragTarget): string => {
    if (dragging) return 'grabbing'
    if (target === 'x1' || target === 'x2') return 'col-resize'
    if (target === 'y1' || target === 'y2') return 'row-resize'
    if (target === 'all') return 'grab'
    return 'crosshair'
  }, [dragging])

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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (!dragging) {
      // Update hover state
      const target = findTarget(x, y)
      setHoverTarget(target)
      return
    }

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
  }, [dragging, dragStart, cursors, setCursorX, setCursorY, findTarget])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setDragging(null)
    setHoverTarget(null)
  }, [])

  if (!cursors.enabled && annotations.length === 0) return <></>

  return (
    <div
      ref={containerRef}
      data-spectrogram-overlay
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        cursor: cursors.enabled ? getCursor(dragging || hoverTarget) : 'default',
        pointerEvents: cursors.enabled ? 'auto' : 'none',
        zIndex: 10
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
