import React, { useState } from 'react'
import { useStore } from '../state/store'
import type { SigMFAnnotation } from '../../shared/sample-formats'

interface AnnotationDialogProps {
  onClose: () => void
}

export function AnnotationDialog({ onClose }: AnnotationDialogProps): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const cursors = useStore((s) => s.cursors)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const viewHeight = useStore((s) => s.viewHeight)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const addAnnotation = useStore((s) => s.addAnnotation)

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

  // Map Y cursor positions to frequencies
  // Canvas Y=0 is top = +sampleRate/2, Y=height is bottom = -sampleRate/2
  // We use a reference height — cursors store pixel positions
  // freq = (0.5 - y/height) * sampleRate, but we don't know height here
  // So we compute freq bounds as normalized fractions of sampleRate
  // Actually cursors.y1/y2 are in pixel space relative to the overlay container
  // We'll compute freq from the cursor Y values normalized against the container
  const hasFreqBounds = cursors.y1 !== cursors.y2

  const handleSave = async () => {
    if (!label.trim()) return

    setSaving(true)
    setError(null)

    try {
      const annotation: SigMFAnnotation = {
        sampleStart: Math.max(0, sampleStart),
        sampleCount: Math.max(1, sampleCount)
      }

      if (hasFreqBounds) {
        // Y pixel position maps to frequency: freq = (0.5 - y/height) * sampleRate
        // But we don't have the container height here. The cursor Y values are in pixels.
        // We need to compute frequency from the cursor positions.
        // The spectrogram maps: top (y=0) = +sampleRate/2, bottom (y=height) = -sampleRate/2
        // But cursor y values are relative to a container whose height we'd need.
        // We can approximate using the same mapping as CursorOverlay's measurements:
        // freqTop = (0.5 - min(y1,y2) / height) * sampleRate
        // We'll grab the height from a DOM query
        // Use viewHeight from store which is the source of truth for the canvas size
        // Must match CursorOverlay/FrequencyAxis mapping: accounts for Y zoom and scroll
        const yNormOffset = yScrollOffset / (fftSize / 2)
        const freqUpper = (0.5 - yNormOffset - Math.min(cursors.y1, cursors.y2) / viewHeight / yZoomLevel) * sampleRate
        const freqLower = (0.5 - yNormOffset - Math.max(cursors.y1, cursors.y2) / viewHeight / yZoomLevel) * sampleRate
        annotation.freqLowerEdge = freqLower
        annotation.freqUpperEdge = freqUpper
      }

      annotation.label = label.trim()
      if (comment.trim()) {
        annotation.comment = comment.trim()
      }

      await window.snailAPI.saveAnnotation(fileInfo.path, annotation)
      addAnnotation(annotation)
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
          <Field label="Frequency Range">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              Defined by cursor Y positions
            </span>
          </Field>
        )}

        <Field label="Label">
          <input
            type="text"
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
