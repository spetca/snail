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
  const setLoading = useStore((s) => s.setLoading)

  // Stride: how many samples between FFT columns. Integer >= 1.
  // zoomLevel > 1 means overlap (stride < fftSize), < 1 means gaps (stride > fftSize)
  const stride = Math.max(1, Math.round(fftSize / zoomLevel))

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

  // Reset on new file: clear old tiles and fit to viewport
  const fittedFileRef = useRef<string | null>(null)
  const initialLoadRef = useRef(false)
  useEffect(() => {
    if (!fileInfo || viewSize.width === 0) return
    const fileKey = `${fileInfo.path}_${fileInfo.totalSamples}`
    if (fittedFileRef.current === fileKey) return
    fittedFileRef.current = fileKey
    initialLoadRef.current = true
    rendererRef.current?.clearTiles()
    generationRef.current++
    const fillZoom = fftSize * viewSize.width / fileInfo.totalSamples
    setZoomLevel(Math.min(fftSize, fillZoom))
    setScrollOffset(0)
  }, [fileInfo, viewSize.width])

  // Render spectrogram
  useEffect(() => {
    if (!fileInfo || !rendererRef.current) return
    if (viewSize.width === 0) return

    const renderer = rendererRef.current
    const tileSampleCoverage = TILE_LINES * stride
    const totalViewSamples = viewSize.width * stride

    const visibleStart = scrollOffset
    const visibleEnd = visibleStart + totalViewSamples

    const firstTileIdx = Math.floor(visibleStart / tileSampleCoverage)
    const lastTileIdx = Math.ceil(visibleEnd / tileSampleCoverage)

    const generation = ++generationRef.current

    const renderParams = {
      scrollOffset,
      fftSize,
      stride,
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
        if (tileSampleStart < 0) continue
        // Skip tiles that start beyond the file
        if (tileSampleStart >= fileInfo.totalSamples) break

        const tileKey = `${tileSampleStart}_${fftSize}_${stride}`
        if (renderer.hasTile(tileKey)) continue
        needed.push({ tileKey, tileSampleStart })
      }

      if (needed.length === 0) {
        if (initialLoadRef.current) { initialLoadRef.current = false; setLoading(false) }
        return
      }

      if (initialLoadRef.current) setLoading(true)
      for (let i = 0; i < needed.length; i += MAX_CONCURRENT_TILES) {
        if (generationRef.current !== generation) return

        const batch = needed.slice(i, i + MAX_CONCURRENT_TILES)
        await Promise.all(batch.map(({ tileKey, tileSampleStart }) =>
          window.snailAPI.computeFFTTile({
            startSample: tileSampleStart,
            fftSize,
            stride
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
      if (initialLoadRef.current) { initialLoadRef.current = false; setLoading(false) }
    }

    loadTiles()
  }, [fileInfo, fftSize, stride, powerMin, powerMax, scrollOffset, viewSize, yZoomLevel, yScrollOffset])

  // Min zoom: enough to fit all samples in the viewport
  const minZoom = fileInfo && viewSize.width > 0
    ? fftSize * viewSize.width / fileInfo.totalSamples
    : 0.01

  // Snap zoom: always guarantee at least ±1 stride change in the intended direction
  const snapZoom = (current: number, factor: number): number => {
    const currentStride = Math.max(1, Math.round(fftSize / current))
    const rawZoom = current * factor
    const newStride = Math.max(1, Math.round(fftSize / rawZoom))

    // If stride didn't change, force it by ±1
    if (newStride === currentStride) {
      const forcedStride = factor > 1
        ? Math.max(1, currentStride - 1)  // zooming in = smaller stride
        : currentStride + 1               // zooming out = larger stride
      return Math.max(minZoom, Math.min(fftSize, fftSize / forcedStride))
    }
    return Math.max(minZoom, Math.min(fftSize, rawZoom))
  }

  // Helper: zoom X axis anchored to mouse X position
  const zoomX = useCallback((factor: number, mouseX: number) => {
    if (!fileInfo) return
    const oldStride = stride
    const newZoom = snapZoom(zoomLevel, factor)
    const newStride = Math.max(1, Math.round(fftSize / newZoom))
    if (newStride === oldStride) return
    setZoomLevel(newZoom)
    if (newZoom <= minZoom) {
      setScrollOffset(0)
    } else {
      const sampleAtCursor = scrollOffset + mouseX * oldStride
      const newOffset = sampleAtCursor - mouseX * newStride
      const maxOffset = Math.max(0, fileInfo.totalSamples - fftSize - viewSize.width * newStride)
      setScrollOffset(Math.max(0, Math.min(maxOffset, Math.round(newOffset))))
    }
  }, [fileInfo, fftSize, zoomLevel, stride, scrollOffset, setScrollOffset, setZoomLevel, minZoom, viewSize.width])

  // Helper: zoom Y axis anchored to mouse Y position
  const zoomY = useCallback((factor: number, mouseY: number, containerHeight: number) => {
    const totalBins = fftSize / 2
    const maxYZoom = totalBins
    const raw = yZoomLevel * factor
    const newYZoom = Math.max(1, Math.min(maxYZoom,
      factor > 1 ? Math.ceil(raw) : Math.floor(raw)))
    if (newYZoom === yZoomLevel) return

    // Bin under cursor before zoom
    const oldVisibleBins = totalBins / yZoomLevel
    const fracY = mouseY / containerHeight // 0=top, 1=bottom
    const binAtCursor = yScrollOffset + fracY * oldVisibleBins

    // Adjust scroll so same bin stays under cursor after zoom
    const newVisibleBins = totalBins / newYZoom
    const newYScroll = binAtCursor - fracY * newVisibleBins
    const maxYScroll = totalBins - newVisibleBins

    setYZoomLevel(newYZoom)
    if (newYZoom <= 1) {
      setYScrollOffset(0)
    } else {
      setYScrollOffset(Math.max(0, Math.min(maxYScroll, newYScroll)))
    }
  }, [fftSize, yZoomLevel, yScrollOffset, setYZoomLevel, setYScrollOffset])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!fileInfo) return
    e.preventDefault()

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift+scroll: pan horizontally (time axis)
      const scrollDelta = Math.round(e.deltaY * stride)
      const maxOffset = Math.max(0, fileInfo.totalSamples - viewSize.width * stride)
      const newOffset = Math.max(0, Math.min(maxOffset, scrollOffset + scrollDelta))
      setScrollOffset(newOffset)
    } else if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Shift+scroll: Y-only zoom
      const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      zoomY(factor, mouseY, rect.height)
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+scroll: X-only zoom anchored to cursor
      const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      zoomX(factor, mouseX)
    } else {
      // Default scroll/pinch: zoom both X and Y (Y at 50% rate)
      const xFactor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      const yFactor = e.deltaY > 0 ? 1 / 1.12 : 1.12 // ~50% rate
      zoomX(xFactor, mouseX)
      zoomY(yFactor, mouseY, rect.height)
    }
  }, [fileInfo, fftSize, stride, zoomLevel, scrollOffset, setScrollOffset, zoomX, zoomY, viewSize.width])

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
