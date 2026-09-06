import { centerFrequencyAt, splitAnnotation } from '../../shared/sigmf'
import { recordingJob } from '../utils/recording'
import React, { useState } from 'react'
import { useStore } from '../state/store'

interface ExportDialogProps {
  onClose: () => void
}

export function ExportDialog({ onClose }: ExportDialogProps): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const cursors = useStore((s) => s.cursors)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const selection = useStore((s) => s.selection)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const pendingExport = useStore((s) => s.pendingExport)
  const setPendingExport = useStore((s) => s.setPendingExport)

  const [description, setDescription] = useState(pendingExport?.comment || '')
  const [author, setAuthor] = useState('')
  const [applyBandpass, setApplyBandpass] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!fileInfo) return <></>

  const samplesPerPixel = Math.max(1, Math.round(fftSize / zoomLevel))
  const startSample = pendingExport ? pendingExport.start : Math.round(Math.min(cursors.x1, cursors.x2) * samplesPerPixel) + scrollOffset
  const endSample = pendingExport ? pendingExport.end : Math.round(Math.max(cursors.x1, cursors.x2) * samplesPerPixel) + scrollOffset
  const isTargetedExport = !!pendingExport

  const handleExport = async () => {
    const job = recordingJob(fileInfo.recordingId)
    try {
      setExporting(true)
      setError(null)

      const exportStart = (cursors.enabled || isTargetedExport) ? startSample : 0
      const exportEnd = (cursors.enabled || isTargetedExport) ? endSample : fileInfo.totalSamples
      if (exportEnd <= exportStart || exportStart < 0 || exportEnd > fileInfo.totalSamples) throw new Error('Select a nonempty range inside the recording')
      const parts = splitAnnotation({ sampleStart: exportStart, sampleCount: exportEnd - exportStart }, fileInfo)
      if (new Set(parts.map(part => part.centerFrequency)).size > 1) throw new Error('This range spans a frequency retune. Export one capture segment at a time.')
      const useBandpass = !isTargetedExport && applyBandpass
      if (useBandpass && (!selection || selection.frequency1 === selection.frequency2)) throw new Error('Select a nonzero frequency range for filtering')
      let defaultName = fileInfo.path.replace(/\.[^.]+$/, '_export')
      if (pendingExport?.label) {
        defaultName = pendingExport.label.toLowerCase().replace(/\s+/g, '_')
      }
      const basePath = await window.snailAPI.showSaveDialog(defaultName)
      if (!job.isCurrent()) return
      if (!basePath) {
        setExporting(false)
        return
      }

      const result = await window.snailAPI.exportSigMF({
            recordingId: fileInfo.recordingId,
        outputPath: basePath,
        startSample: exportStart,
        endSample: exportEnd,
        description,
        author,
        applyBandpass: useBandpass,
        bandpassLow: selection ? Math.min(selection.frequency1, selection.frequency2) : undefined,
        bandpassHigh: selection ? Math.max(selection.frequency1, selection.frequency2) : undefined,
        sampleRate,
        centerFrequency: centerFrequencyAt(fileInfo, exportStart)
      })

      if (!job.isCurrent()) return
      if (result.success) {
        setPendingExport(null)
        onClose()
      } else {
        setError(result.error || 'Export failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Export SigMF</h3>

        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Signal description..."
            style={{ width: '100%' }}
          />
        </Field>

        <Field label="Author">
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author name..."
            style={{ width: '100%' }}
          />
        </Field>

        <Field label="Sample Range">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {(cursors.enabled || isTargetedExport)
              ? `${startSample.toLocaleString()} - ${endSample.toLocaleString()} (${(endSample - startSample).toLocaleString()} samples)`
              : `0 - ${fileInfo.totalSamples.toLocaleString()} (all)`}
          </span>
        </Field>

        {cursors.enabled && (
          <Field label="">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={applyBandpass}
                onChange={(e) => setApplyBandpass(e.target.checked)}
              />
              <span style={{ fontSize: 12 }}>Apply bandpass filter (Y cursor range)</span>
            </label>
          </Field>
        )}

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      )}
      {children}
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
}

const modalStyle: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  width: 400,
  maxWidth: '90%'
}
