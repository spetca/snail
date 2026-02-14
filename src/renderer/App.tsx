import React, { useCallback } from 'react'
import { useStore } from './state/store'
import { Toolbar } from './components/Toolbar'
import { ControlsPanel } from './components/ControlsPanel'
import { SpectrogramView } from './components/SpectrogramView'
import { TracePlot } from './components/TracePlot'
import { CorrelationPlot } from './components/CorrelationPlot'
import { TimeAxis } from './components/TimeAxis'
import { FrequencyAxis } from './components/FrequencyAxis'
import { CursorOverlay } from './components/CursorOverlay'
import { StatusBar } from './components/StatusBar'
import { ExportDialog } from './components/ExportDialog'
import { CorrelationDialog } from './components/CorrelationDialog'

export default function App(): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const setFileInfo = useStore((s) => s.setFileInfo)
  const setLoading = useStore((s) => s.setLoading)
  const setError = useStore((s) => s.setError)
  const correlationData = useStore((s) => s.correlationData)
  const [showExport, setShowExport] = React.useState(false)
  const [showCorrelation, setShowCorrelation] = React.useState(false)

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

      <Toolbar
        onExport={() => setShowExport(true)}
        onCorrelation={() => setShowCorrelation(true)}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ControlsPanel />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {fileInfo ? (
            <>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <SpectrogramView />
                  <CursorOverlay />
                </div>
                <FrequencyAxis />
              </div>
              <TimeAxis />
              <TracePlot />
              {correlationData && <CorrelationPlot />}
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
      {showCorrelation && <CorrelationDialog onClose={() => setShowCorrelation(false)} />}
    </div>
  )
}
