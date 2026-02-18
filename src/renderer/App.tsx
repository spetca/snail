import React, { useCallback } from 'react'
import { useStore } from './state/store'
import { Toolbar } from './components/Toolbar'
import { ControlsPanel } from './components/ControlsPanel'
import { SpectrogramView } from './components/SpectrogramView'
import { TracePlot } from './components/TracePlot'
import { CorrelationPane } from './components/CorrelationPane'
import { TimeAxis } from './components/TimeAxis'
import { FrequencyAxis } from './components/FrequencyAxis'
import { CursorOverlay } from './components/CursorOverlay'
import { ScrollBar } from './components/ScrollBar'
import { StatusBar } from './components/StatusBar'
import { ExportDialog } from './components/ExportDialog'
import { AnnotationDialog } from './components/AnnotationDialog'

export default function App(): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const setFileInfo = useStore((s) => s.setFileInfo)
  const setLoading = useStore((s) => s.setLoading)
  const setError = useStore((s) => s.setError)
  const loading = useStore((s) => s.loading)
  const correlationEnabled = useStore((s) => s.correlationEnabled)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const setScrollOffset = useStore((s) => s.setScrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const setYScrollOffset = useStore((s) => s.setYScrollOffset)
  const showExport = useStore((s) => s.showExportDialog)
  const setShowExport = useStore((s) => s.setShowExportDialog)
  const showAnnotation = useStore((s) => s.showAnnotationDialog)
  const setShowAnnotation = useStore((s) => s.setShowAnnotationDialog)

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      setLoading(true)
      const filePath = window.snailAPI.getPathForFile(file)
      const info = await window.snailAPI.openFile(filePath)
      setFileInfo(info)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [setFileInfo, setLoading, setError])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // Compute scrollbar parameters
  const totalSamples = fileInfo?.totalSamples ?? 0
  const stride = fftSize / zoomLevel
  const xViewportSamples = 800 * stride
  const totalFreqBins = fftSize / 2
  const visibleFreqBins = totalFreqBins / yZoomLevel

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg1)'
      }}
    >
      {navigator.userAgent.includes('Mac') && <div className="titlebar-drag" />}

      <Toolbar onExport={() => setShowExport(true)} onAnnotate={() => setShowAnnotation(true)} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ControlsPanel />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(15, 17, 21, 0.85)',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading file...</span>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}
          {fileInfo ? (
            <>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    <SpectrogramView />
                    <CursorOverlay />
                  </div>
                  {yZoomLevel > 1 && (
                    <ScrollBar
                      orientation="vertical"
                      totalRange={totalFreqBins}
                      viewportSize={visibleFreqBins}
                      value={yScrollOffset}
                      onChange={setYScrollOffset}
                    />
                  )}
                  <FrequencyAxis />
                </div>
                <ScrollBar
                  orientation="horizontal"
                  totalRange={totalSamples}
                  viewportSize={xViewportSamples}
                  value={scrollOffset}
                  onChange={setScrollOffset}
                />
              </div>
              <TimeAxis />
              <TracePlot />
              <CorrelationPane />
            </>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                color: 'var(--text-dim)',
                fontSize: 14,
                border: '2px dashed var(--border)',
                margin: 24,
                borderRadius: 12
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span>Drop an IQ file here to get started</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Supports .cf32, .cs16, .cu8, .sigmf-data, and more
              </span>
            </div>
          )}
        </div>
      </div>

      <StatusBar />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showAnnotation && <AnnotationDialog onClose={() => setShowAnnotation(false)} />}
    </div>
  )
}
