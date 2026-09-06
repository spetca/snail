import { formatFrequency } from '../../shared/units'
import { recordingJob } from '../utils/recording'
import React, { useState } from 'react'
import { useStore } from '../state/store'
import type { SigMFAnnotation } from '../../shared/sample-formats'

interface AnnotationDialogProps {
  onClose: () => void
}

export function AnnotationDialog({ onClose }: AnnotationDialogProps): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const selection = useStore((s) => s.selection)
  const cursors = useStore((s) => s.cursors)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const viewHeight = useStore((s) => s.viewHeight)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const setSigmfMetadata = useStore((s) => s.setSigmfMetadata)
  const frequencyMode = useStore((s) => s.annotationFrequencyMode)

  const [label, setLabel] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!fileInfo) return <></>

  // Stride must match SpectrogramView: integer rounded
  const stride = Math.max(1, Math.round(fftSize / zoomLevel))
  const samplesPerPixel = stride
  const sampleStart = Math.round(Math.min(cursors.x1, cursors.x2) * samplesPerPixel) + scrollOffset
  const sampleEnd = Math.round(Math.max(cursors.x1, cursors.x2) * samplesPerPixel) + scrollOffset
  const sampleCount = sampleEnd - sampleStart

  const hasFreqBounds = selection ? selection.frequency1 !== selection.frequency2 : cursors.y1 !== cursors.y2
  const frequencyUpper = selection ? Math.max(selection.frequency1, selection.frequency2)
    : (0.5 - yScrollOffset / (fftSize / 2) - Math.min(cursors.y1, cursors.y2) / viewHeight / yZoomLevel) * sampleRate
  const frequencyLower = selection ? Math.min(selection.frequency1, selection.frequency2)
    : (0.5 - yScrollOffset / (fftSize / 2) - Math.max(cursors.y1, cursors.y2) / viewHeight / yZoomLevel) * sampleRate

  const handleSave = async () => {
    const job = recordingJob(fileInfo.recordingId)
    if (!label.trim()) return
    if (sampleCount <= 0 || sampleEnd > fileInfo.totalSamples) { setError('Select a nonempty range inside the recording'); return }

    setSaving(true)
    setError(null)

    try {
      const annotation: SigMFAnnotation = {
        sampleStart: Math.max(0, sampleStart),
        sampleCount
      }

      if (hasFreqBounds) {
        // The writer converts baseband bounds to RF separately for each capture.
        annotation.freqLowerEdge = frequencyLower
        annotation.freqUpperEdge = frequencyUpper
      }

      annotation.label = label.trim()
      if (comment.trim()) {
        annotation.comment = comment.trim()
      }

      const result = await window.snailAPI.saveAnnotation(fileInfo.path, annotation, fileInfo.recordingId, frequencyMode, sampleRate)
      if (!job.isCurrent()) return
      setSigmfMetadata(result.sigmfMetaJson)
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Add Annotation</h3>

        <Field label="Sample Range">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {sampleStart} - {sampleEnd} ({sampleCount} samples)
          </span>
        </Field>

        {hasFreqBounds && (
          <Field label="Baseband Frequency Range">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {formatFrequency(frequencyLower)} to {formatFrequency(frequencyUpper)}
            </span>
          </Field>
        )}

        {frequencyMode === 'legacy-baseband' && (
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            Saving converts existing annotation frequency bounds from legacy baseband to RF.
          </p>
        )}
        <Field label="Label">
          <input
            type="text"
            list="signal-types"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Signal label (required)..."
            style={{ width: '100%' }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) handleSave()
              if (e.key === 'Escape') onClose()
            }}
          />
          <datalist id="signal-types">
            <option value="lora" />
            <option value="wifi" />
            <option value="zigbee" />
            <option value="bluetooth" />
            <option value="fm" />
            <option value="am" />
            <option value="dect" />
            <option value="lte" />
            <option value="gsm" />
            <option value="aprs" />
            <option value="ads-b" />
          </datalist>
        </Field>

        <Field label="Comment">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment..."
            style={{ width: '100%' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) handleSave()
              if (e.key === 'Escape') onClose()
            }}
          />
        </Field>

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={handleSave}
            disabled={saving || !label.trim()}
          >
            {saving ? 'Saving...' : 'Save'}
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
