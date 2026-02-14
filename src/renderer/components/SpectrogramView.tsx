import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../state/store'
import { SpectrogramRenderer, TILE_LINES } from '../webgl/SpectrogramRenderer'

const MAX_CONCURRENT_TILES = 4

export function SpectrogramView(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SpectrogramRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track size as state so changes trigger re-render
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 })
  const generationRef = useRef(0)

  const fileInfo = useStore((s) => s.fileInfo)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const powerMin = useStore((s) => s.powerMin)
  const powerMax = useStore((s) => s.powerMax)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const setScrollOffset = useStore((s) => s.setScrollOffset)
  const setZoomLevel = useStore((s) => s.setZoomLevel)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const setYZoomLevel = useStore((s) => s.setYZoomLevel)
  const setYScrollOffset = useStore((s) => s.setYScrollOffset)

  // Initialize WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const renderer = new SpectrogramRenderer(canvas)
      rendererRef.current = renderer
    } catch (e) {
      console.error('Failed to init WebGL renderer:', e)
    }

    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  // Resize canvas to match container
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width === 0 || height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      rendererRef.current?.resize(width * dpr, height * dpr)
      setViewSize({ width, height })
      useStore.getState().setViewWidth(width)
      useStore.getState().setViewHeight(height)
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Auto-fill: zoom so signal spans the full viewport width on file load
  useEffect(() => {
    if (!fileInfo || viewSize.width === 0) return
    // stride = fftSize / zoom, viewSamples = viewWidth * stride
    // For fill: viewSamples <= totalSamples → zoom >= fftSize * viewWidth / totalSamples
    const fillZoom = Math.ceil(fftSize * viewSize.width / fileInfo.totalSamples)
    setZoomLevel(Math.max(1, Math.min(fftSize, fillZoom)))
    setScrollOffset(0)
  }, [fileInfo]) // only on new file, not on every resize/fftSize change

  // Render spectrogram
  useEffect(() => {
    if (!fileInfo || !rendererRef.current) return
    if (viewSize.width === 0) return

    const renderer = rendererRef.current
    const stride = fftSize / zoomLevel
    const tileSampleCoverage = TILE_LINES * stride
    const samplesPerPixel = stride
    const totalViewSamples = viewSize.width * samplesPerPixel

    const visibleStart = scrollOffset
    const visibleEnd = visibleStart + totalViewSamples

    const firstTileIdx = Math.floor(visibleStart / tileSampleCoverage)
    const lastTileIdx = Math.ceil(visibleEnd / tileSampleCoverage)

    const generation = ++generationRef.current

    const renderParams = {
      scrollOffset,
      fftSize,
      zoomLevel,
      powerMin,
      powerMax,
      totalSamples: fileInfo.totalSamples,
      yZoomLevel,
      yScrollOffset: yScrollOffset / (fftSize / 2)
    }

    // Always render immediately with cached tiles
    renderer.render(renderParams)

    const loadTiles = async () => {
      const needed: { tileKey: string; tileSampleStart: number }[] = []

      for (let tIdx = firstTileIdx; tIdx <= lastTileIdx; tIdx++) {
        const tileSampleStart = tIdx * tileSampleCoverage
        if (tileSampleStart >= fileInfo.totalSamples) break
        if (tileSampleStart < 0) continue

        const tileKey = `${tileSampleStart}_${fftSize}_${zoomLevel}`
        if (renderer.hasTile(tileKey)) continue
        needed.push({ tileKey, tileSampleStart })
      }

      if (needed.length === 0) return

      for (let i = 0; i < needed.length; i += MAX_CONCURRENT_TILES) {
        if (generationRef.current !== generation) return

        const batch = needed.slice(i, i + MAX_CONCURRENT_TILES)
        await Promise.all(batch.map(({ tileKey, tileSampleStart }) =>
          window.snailAPI.computeFFTTile({
            startSample: tileSampleStart,
            fftSize,
            zoomLevel
          }).then((rawData) => {
            if (generationRef.current !== generation) return
            if (!rawData) return

            let data: Float32Array
            const dataObj = rawData as any
            if (dataObj instanceof Float32Array) {
              data = dataObj
            } else if (dataObj instanceof ArrayBuffer) {
              data = new Float32Array(dataObj)
            } else if (dataObj.buffer instanceof ArrayBuffer) {
              data = new Float32Array(dataObj.buffer)
            } else {
              data = new Float32Array(dataObj)
            }
            if (data.length > 0) {
              renderer.uploadTile(tileKey, data, fftSize)
            }
          }).catch(() => { })
        ))

        if (generationRef.current === generation) {
          renderer.render(renderParams)
        }
      }
    }

    loadTiles()
  }, [fileInfo, fftSize, zoomLevel, powerMin, powerMax, scrollOffset, viewSize, yZoomLevel, yScrollOffset])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!fileInfo) return

    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift+wheel: Y-axis zoom (frequency)
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      const maxYZoom = fftSize / 2
      const newYZoom = Math.max(1, Math.min(maxYZoom, Math.round(yZoomLevel * factor)))
      if (newYZoom === yZoomLevel) return

      // Clamp Y scroll offset
      const totalBins = fftSize / 2
      const visibleBins = totalBins / newYZoom
      const maxYScroll = totalBins - visibleBins
      setYZoomLevel(newYZoom)
      setYScrollOffset(Math.max(0, Math.min(maxYScroll, yScrollOffset)))
    } else if (e.ctrlKey || e.metaKey) {
      // Smart zoom: keep the sample under the cursor fixed
      e.preventDefault()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mouseX = e.clientX - rect.left // CSS pixels from left edge

      const oldStride = fftSize / zoomLevel
      // Multiplicative zoom: each scroll step scales by ~1.25x, snapped to integer
      const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      const newZoom = Math.max(1, Math.min(fftSize, Math.round(zoomLevel * factor)))
      if (newZoom === zoomLevel) return

      const newStride = fftSize / newZoom

      // Sample under cursor before zoom
      const sampleAtCursor = scrollOffset + mouseX * oldStride
      // Adjust scroll so same sample stays under cursor after zoom
      const newOffset = sampleAtCursor - mouseX * newStride
      const maxOffset = Math.max(0, fileInfo.totalSamples - fftSize)

      setZoomLevel(newZoom)
      setScrollOffset(Math.max(0, Math.min(maxOffset, Math.round(newOffset))))
    } else {
      const stride = fftSize / zoomLevel
      const scrollDelta = Math.round(e.deltaY * stride)
      const maxOffset = Math.max(0, fileInfo.totalSamples - fftSize)
      const newOffset = Math.max(0, Math.min(maxOffset, scrollOffset + scrollDelta))
      setScrollOffset(newOffset)
    }
  }, [fileInfo, fftSize, zoomLevel, scrollOffset, setScrollOffset, setZoomLevel, yZoomLevel, yScrollOffset, setYZoomLevel, setYScrollOffset])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', minHeight: 100 }}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
    </div>
  )
}
