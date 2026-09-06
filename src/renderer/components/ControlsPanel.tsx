import { NumericInput } from './NumericInput'
import { centerFrequencyAt, captureSegments } from '../../shared/sigmf'
import { recordingJob } from '../utils/recording'
import React, { useEffect, useState } from 'react'
import { useStore, type XAxisMode, type CursorState } from '../state/store'
import type { SigMFAnnotation, ClassificationResult } from '../../shared/sample-formats'
import { formatTimeValue, formatFrequency } from '../../shared/units'

const ANNOTATION_COLORS = ['#FF6B6B', '#4DABF7', '#51CF66', '#FFD43B', '#CC5DE8', '#FF922B']

const FFT_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192]

export function ControlsPanel(): React.ReactElement {
  const fileInfo = useStore((s) => s.fileInfo)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const powerMin = useStore((s) => s.powerMin)
  const powerMax = useStore((s) => s.powerMax)
  const sampleRate = useStore((s) => s.sampleRate)
  const xAxisMode = useStore((s) => s.xAxisMode)
  const cursors = useStore((s) => s.cursors)
  const cursorsEnabled = cursors.enabled
  const selection = useStore((s) => s.selection)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const viewHeight = useStore((s) => s.viewHeight)
  const annotations = useStore((s) => s.annotations)
  const frequencyMode = useStore((s) => s.annotationFrequencyMode)
  const setFrequencyMode = useStore((s) => s.setAnnotationFrequencyMode)
  const annotationsVisible = useStore((s) => s.annotationsVisible)
  const viewWidth = useStore((s) => s.viewWidth)
  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const selectedAnnotationIndex = useStore((s) => s.selectedAnnotationIndex)
  const setSelectedAnnotationIndex = useStore((s) => s.setSelectedAnnotationIndex)
  const classificationResults = useStore((s) => s.classificationResults)
  const classifierLoaded = useStore((s) => s.classifierLoaded)
  const classifierLabels = useStore((s) => s.classifierLabels)
  const setClassificationResults = useStore((s) => s.setClassificationResults)
  const setClassifierLoaded = useStore((s) => s.setClassifierLoaded)
  const setClassifierLabels = useStore((s) => s.setClassifierLabels)

  const setFFTSize = useStore((s) => s.setFFTSize)
  const setZoomLevel = useStore((s) => s.setZoomLevel)
  const setPowerMin = useStore((s) => s.setPowerMin)
  const setPowerMax = useStore((s) => s.setPowerMax)
  const setSampleRate = useStore((s) => s.setSampleRate)
  const setXAxisMode = useStore((s) => s.setXAxisMode)
  const setCursorsEnabled = useStore((s) => s.setCursorsEnabled)
  const setAnnotationsVisible = useStore((s) => s.setAnnotationsVisible)
  const setScrollOffset = useStore((s) => s.setScrollOffset)
  const snapToView = useStore((s) => s.snapToView)
  const showAbsoluteFrequency = useStore((s) => s.showAbsoluteFrequency)
  const setShowAbsoluteFrequency = useStore((s) => s.setShowAbsoluteFrequency)

  const analysisSelection = fileInfo && selection && cursors.enabled ? {
    recordingId: fileInfo.recordingId,
    start: Math.min(selection.sample1, selection.sample2),
    length: Math.abs(selection.sample2 - selection.sample1),
    fs: sampleRate
  } : null

  // Only physical sample changes trigger analysis, not viewport reprojection.
  useEffect(() => {
    const range = analysisSelection?.length ? analysisSelection : null
    window.snailAPI.sendFFTUpdate(range)
    window.snailAPI.sendConstellationUpdate(range)
  }, [fileInfo?.recordingId, selection?.sample1, selection?.sample2, cursors.enabled, sampleRate])

  const handleAnnotationClick = (ann: SigMFAnnotation) => {
    if (!fileInfo) return
    const targetZoom = (viewWidth * fftSize * 0.8) / ann.sampleCount
    const newZoom = Math.min(fftSize, targetZoom)
    setZoomLevel(newZoom)

    const newStride = fftSize / newZoom
    const centerSample = ann.sampleStart + ann.sampleCount / 2
    const viewSamples = viewWidth * newStride
    const newOffset = centerSample - viewSamples / 2
    const maxOffset = Math.max(0, fileInfo.totalSamples - fftSize)
    setScrollOffset(Math.max(0, Math.min(maxOffset, Math.round(newOffset))))
  }

  return (
    <div
      style={{
        width: 220,
        background: 'var(--bg2)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
        borderRight: '1px solid var(--border)'
      }}
    >
      <Section title="Sample Rate">
        <NumericInput aria-label="Sample rate (Hz)" positive commitOnBlur
          value={sampleRate}
          onValueChange={setSampleRate}
          style={{ width: '100%' }}
        />
      </Section>

      <Section title="FFT Size">
        <select
          value={fftSize}
          onChange={(e) => setFFTSize(Number(e.target.value))}
          style={{ width: '100%' }}
        >
          {FFT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Section>

      <Section title="Zoom">
        <input
          type="range"
          min={-10}
          max={Math.log2(fftSize)}
          step={0.1}
          value={Math.log2(zoomLevel)}
          onChange={(e) => {
            const z = Math.pow(2, Number(e.target.value))
            setZoomLevel(Math.min(fftSize, z))
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={valStyle}>{zoomLevel < 0.1 ? zoomLevel.toExponential(2) : zoomLevel.toFixed(2)}x</span>
          <button
            onClick={snapToView}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 10,
              padding: '2px 8px',
              cursor: 'pointer',
              borderRadius: 3
            }}
          >
            Fit All
          </button>
        </div>
      </Section>

      <Section title="Power (dB)">
        <label style={labelStyle}>
          Min
          <input
            type="range"
            min={-150}
            max={0}
            value={powerMin}
            onChange={(e) => setPowerMin(Number(e.target.value))}
          />
          <span style={valStyle}>{powerMin}</span>
        </label>
        <label style={labelStyle}>
          Max
          <input
            type="range"
            min={-150}
            max={0}
            value={powerMax}
            onChange={(e) => setPowerMax(Number(e.target.value))}
          />
          <span style={valStyle}>{powerMax}</span>
        </label>
      </Section>

      <Section title="X Axis">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['samples', 'time'] as XAxisMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setXAxisMode(mode)}
              style={{
                flex: 1,
                background: xAxisMode === mode ? 'var(--accent)' : 'var(--surface)',
                color: xAxisMode === mode ? 'var(--bg0)' : 'var(--text)',
                fontWeight: xAxisMode === mode ? 500 : 400,
                borderColor: xAxisMode === mode ? 'var(--accent)' : 'var(--border)'
              }}
            >
              {mode === 'samples' ? 'Samples' : 'Time'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Cursors">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cursorsEnabled}
            onChange={(e) => setCursorsEnabled(e.target.checked)}
          />
          <span style={{ fontSize: 12 }}>Enable cursors</span>
        </label>
      </Section>

      {cursorsEnabled && cursors.x1 !== cursors.x2 && (
        <CursorInfoSection
          cursors={cursors}
          fftSize={fftSize}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          sampleRate={sampleRate}
          viewHeight={viewHeight}
          yZoomLevel={yZoomLevel}
          yScrollOffset={yScrollOffset}
          showAbsoluteFrequency={showAbsoluteFrequency}
          centerFrequency={centerFrequencyAt(fileInfo, scrollOffset)}
          onTakeFFT={() => {
            window.snailAPI.sendFFTUpdate(analysisSelection)
            window.snailAPI.openFFTWindow()
          }}
          onTakeConstellation={() => {
            window.snailAPI.sendConstellationUpdate(analysisSelection)
            window.snailAPI.openConstellationWindow()
          }}
        />
      )}

      {fileInfo && (
        <Section title="File Info">
          <InfoRow label="Format" value={fileInfo.format} />
          <InfoRow label="Samples" value={fileInfo.totalSamples.toLocaleString()} />
          <InfoRow label="Size" value={formatBytes(fileInfo.fileSize)} />
          {fileInfo.centerFrequency && (
            <>
              {captureSegments(fileInfo).length > 1 && <p style={{ fontSize: 11 }}>Multiple captures: the RF axis uses tuning at the left edge of the view.</p>}
              <InfoRow label="Center" value={`${(fileInfo.centerFrequency / 1e6).toFixed(3)} MHz`} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={showAbsoluteFrequency}
                  onChange={(e) => setShowAbsoluteFrequency(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Absolute frequency</span>
              </label>
            </>
          )}
        </Section>
      )}

      {annotations.length > 0 && (
        <Section title="Annotations">
          <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
            Imported frequency bounds
            <select value={frequencyMode} onChange={(e) => setFrequencyMode(e.target.value as 'rf' | 'legacy-baseband')} style={{ width: '100%', marginTop: 4 }}>
              <option value="rf">SigMF (RF frequencies)</option>
              <option value="legacy-baseband">Legacy Snail (baseband)</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={annotationsVisible}
              onChange={(e) => {
                setAnnotationsVisible(e.target.checked)
                if (!e.target.checked) setSelectedAnnotationIndex(null)
              }}
            />
            <span style={{ fontSize: 12 }}>Show on spectrogram</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {annotations.map((ann, i) => {
              const color = ANNOTATION_COLORS[i % ANNOTATION_COLORS.length]
              const isSelected = selectedAnnotationIndex === i
              return (
                <div
                  key={i}
                  onClick={() => {
                    handleAnnotationClick(ann)
                    setSelectedAnnotationIndex(i)
                  }}
                  style={{
                    padding: '6px 8px',
                    background: isSelected ? `${color}33` : 'var(--bg3)',
                    border: `1px solid ${isSelected ? color : color + '44'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = color
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = `${color}44`
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {ann.label || `Annotation ${i + 1}`}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    S: {ann.sampleStart.toLocaleString()} ({ann.sampleCount.toLocaleString()})
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {fileInfo && (
        <ClassifierSection
          fileInfo={fileInfo}
          annotations={annotations}
          cursors={cursors}
          fftSize={fftSize}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          classifierLoaded={classifierLoaded}
          classifierLabels={classifierLabels}
          classificationResults={classificationResults}
          onClassifierLoaded={(labels) => {
            setClassifierLoaded(true)
            setClassifierLabels(labels)
          }}
          onClassificationResults={setClassificationResults}
        />
      )}
    </div>
  )
}

function CursorInfoSection({
  cursors, fftSize, zoomLevel, scrollOffset, sampleRate,
  viewHeight, yZoomLevel, yScrollOffset, showAbsoluteFrequency, centerFrequency, onTakeFFT, onTakeConstellation
}: {
  cursors: CursorState
  fftSize: number
  zoomLevel: number
  scrollOffset: number
  sampleRate: number
  viewHeight: number
  yZoomLevel: number
  yScrollOffset: number
  showAbsoluteFrequency: boolean
  centerFrequency: number
  onTakeFFT: () => void
  onTakeConstellation: () => void
}) {
  const samplesPerPx = Math.max(1, Math.round(fftSize / zoomLevel))
  const s1 = Math.round(cursors.x1 * samplesPerPx + scrollOffset)
  const s2 = Math.round(cursors.x2 * samplesPerPx + scrollOffset)
  const sampleDelta = Math.abs(s2 - s1)
  const timeDelta = sampleDelta / sampleRate

  const yNormOffset = viewHeight > 0 ? yScrollOffset / (fftSize / 2) : 0
  const cf = showAbsoluteFrequency ? centerFrequency : 0
  const freqFromY = (yPx: number) => viewHeight > 0
    ? (0.5 - yNormOffset - yPx / viewHeight / yZoomLevel) * sampleRate + cf
    : 0
  const f1 = freqFromY(cursors.y1)
  const f2 = freqFromY(cursors.y2)
  const bandwidth = Math.abs(f1 - f2)

  return (
    <Section title="Cursor Info">
      <InfoRow label="Samples" value={`${Math.min(s1, s2).toLocaleString()} - ${Math.max(s1, s2).toLocaleString()}`} />
      <InfoRow label={'\u0394 Samples'} value={sampleDelta.toLocaleString()} />
      <InfoRow label={'\u0394 Time'} value={formatTimeValue(timeDelta)} />
      {cursors.y1 !== cursors.y2 && (
        <>
          <InfoRow label="BW" value={formatFrequency(bandwidth)} />
          {showAbsoluteFrequency && (
            <>
              <InfoRow label="F1" value={formatFrequency(Math.max(f1, f2))} />
              <InfoRow label="F2" value={formatFrequency(Math.min(f1, f2))} />
            </>
          )}
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={onTakeFFT}
          style={{
            flex: 1,
            background: 'var(--accent)',
            color: 'var(--bg0)',
            fontWeight: 600,
            padding: '6px 0',
            borderRadius: 4,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          FFT
        </button>
        <button
          onClick={onTakeConstellation}
          style={{
            flex: 1,
            background: 'var(--bg3)',
            color: 'var(--text)',
            fontWeight: 600,
            padding: '6px 0',
            borderRadius: 4,
            border: '1px solid var(--border)',
            cursor: 'pointer'
          }}
        >
          IQ
        </button>
      </div>
    </Section>
  )
}

function ClassifierSection({
  fileInfo, annotations, cursors, fftSize, zoomLevel, scrollOffset,
  classifierLoaded, classifierLabels, classificationResults,
  onClassifierLoaded, onClassificationResults
}: {
  fileInfo: { totalSamples: number; recordingId: string }
  annotations: SigMFAnnotation[]
  cursors: CursorState
  fftSize: number
  zoomLevel: number
  scrollOffset: number
  classifierLoaded: boolean
  classifierLabels: string[]
  classificationResults: ClassificationResult[]
  onClassifierLoaded: (labels: string[]) => void
  onClassificationResults: (results: ClassificationResult[]) => void
}) {
  const [extracting, setExtracting] = useState(false)
  const [training, setTraining] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [minConfidence, setMinConfidence] = useState(0.15)
  const [featuresPath, setFeaturesPath] = useState<string | null>(null)
  const [classBreakdown, setClassBreakdown] = useState<Record<string, number>>({})

  const FRAME_SIZE = 256
  const numClasses = Object.keys(classBreakdown).length

  const handleExtract = async () => {
    const job = recordingJob(fileInfo.recordingId)
    const labeled = annotations.filter((a) => !!a.label)
    if (labeled.length === 0) {
      setStatusMsg('No labeled annotations on this file')
      return
    }
    setExtracting(true)
    setStatusMsg('Extracting features...')
    try {
      const allFeatures: Float32Array[] = []
      const allLabels: string[] = []

      for (const ann of labeled) {
        const res = await window.snailAPI.extractFeatures({
          recordingId: job.recordingId,
          startSample: ann.sampleStart,
          sampleCount: ann.sampleCount,
          frameSize: FRAME_SIZE
        })
        job.assertCurrent()
        if (res.frameCount > 0) {
          allFeatures.push(res.features)
          for (let i = 0; i < res.frameCount; ++i) allLabels.push(ann.label!)
        }
      }

      if (allLabels.length === 0) {
        setStatusMsg('Annotations too short — need at least 256 samples each')
        return
      }

      const totalFloats = allFeatures.reduce((s, f) => s + f.length, 0)
      const combined = new Float32Array(totalFloats)
      let off = 0
      for (const f of allFeatures) { combined.set(f, off); off += f.length }

      if (!featuresPath) setStatusMsg('Choose where to save features.json...')
      const exportResult = await window.snailAPI.exportFeatures({
        recordingId: job.recordingId,
        features: combined, labels: allLabels, frameSize: FRAME_SIZE,
        appendToPath: featuresPath ?? undefined
      })
      if (!job.isCurrent()) return
      if (!exportResult.success) {
        if (!exportResult.canceled) setStatusMsg('Save failed')
        else setStatusMsg(null)
        return
      }

      setFeaturesPath(exportResult.path!)
      setClassBreakdown(exportResult.classBreakdown ?? {})
      const bd = exportResult.classBreakdown ?? {}
      const summary = Object.entries(bd).map(([k, v]) => `${k}×${v}`).join(', ')
      setStatusMsg(exportResult.appended ? `Appended. Total: ${summary}` : `Saved. Total: ${summary}`)
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`)
    } finally {
      setExtracting(false)
    }
  }

  const handleTrain = async () => {
    const job = recordingJob(fileInfo.recordingId)
    if (!featuresPath) return
    setTraining(true)
    setStatusMsg('Training...')
    try {
      const trainResult = await window.snailAPI.trainClassifier(featuresPath)
      if (!job.isCurrent()) return
      if (!trainResult.success) {
        setStatusMsg(`Training failed: ${trainResult.error}`)
        return
      }
      setStatusMsg('Loading model...')
      const loadResult = await window.snailAPI.loadClassifier(trainResult.modelPath!)
      if (loadResult.success && loadResult.labels) {
        onClassifierLoaded(loadResult.labels)
        setStatusMsg(`Ready: ${loadResult.labels.join(', ')}`)
      } else {
        setStatusMsg(`Load failed: ${loadResult.error}`)
      }
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`)
    } finally {
      setTraining(false)
    }
  }

  const handleLoadModel = async () => {
    const job = recordingJob(fileInfo.recordingId)
    const path = await window.snailAPI.showOpenJsonDialog()
    if (!path || !job.isCurrent()) return
    try {
      const res = await window.snailAPI.loadClassifier(path)
      if (res.success && res.labels) {
        onClassifierLoaded(res.labels)
        setStatusMsg(`Loaded: ${res.labels.join(', ')}`)
      } else {
        const hint = res.error?.includes('n_components') ? ' (load model.json, not features.json)' : ''
        setStatusMsg(`Load failed: ${res.error}${hint}`)
      }
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`)
    }
  }

  const handleClassify = async () => {
    const job = recordingJob(fileInfo.recordingId)
    setClassifying(true)
    setStatusMsg(null)
    try {
      const samplesPerPx = Math.max(1, Math.round(fftSize / zoomLevel))
      let startSample: number, sampleCount: number

      if (cursors.enabled && cursors.x1 !== cursors.x2) {
        const px1 = Math.min(cursors.x1, cursors.x2)
        const px2 = Math.max(cursors.x1, cursors.x2)
        startSample = Math.round(px1 * samplesPerPx + scrollOffset)
        sampleCount = Math.round((px2 - px1) * samplesPerPx)
      } else {
        startSample = 0
        sampleCount = fileInfo.totalSamples
      }

      const results = await window.snailAPI.classifyRegion({
        recordingId: job.recordingId,
        startSample,
        sampleCount,
        frameSize: FRAME_SIZE
      })
      if (!job.isCurrent()) return
      const confident = results.filter((r) => r.confidence >= minConfidence)
      onClassificationResults(confident)
      const rejected = results.length - confident.length
      setStatusMsg(`${confident.length} frames above threshold${rejected > 0 ? `, ${rejected} rejected` : ''}`)
    } catch (e: any) {
      setStatusMsg(`Error: ${e.message}`)
    } finally {
      setClassifying(false)
    }
  }

  const btnStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 0',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    marginBottom: 4
  }

  return (
    <Section title="Classifier">
      <button
        style={{ ...btnStyle, background: 'var(--surface)', color: 'var(--text)' }}
        onClick={handleExtract}
        disabled={extracting || training}
      >
        {extracting ? 'Extracting...' : '1. Extract Features'}
      </button>

      {/* Class breakdown — shown once at least one file has been extracted */}
      {numClasses > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
            <span>{featuresPath?.split('/').pop()} — {numClasses} class{numClasses !== 1 ? 'es' : ''}</span>
            <span
              onClick={() => { setFeaturesPath(null); setClassBreakdown({}) }}
              style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
            >reset</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {Object.entries(classBreakdown).map(([lbl, count]) => (
              <span key={lbl} style={{
                fontSize: 10, fontFamily: 'var(--font-mono)',
                background: numClasses < 2 ? 'rgba(255,100,100,0.15)' : 'var(--surface)',
                border: `1px solid ${numClasses < 2 ? 'rgba(255,100,100,0.5)' : 'var(--border)'}`,
                borderRadius: 3, padding: '1px 5px', color: 'var(--text)'
              }}>{lbl} ×{count}</span>
            ))}
          </div>
          {numClasses < 2 && (
            <div style={{ fontSize: 10, color: '#ff6b6b', marginTop: 3 }}>
              Need ≥2 classes to train. Open another file and extract.
            </div>
          )}
        </div>
      )}

      <button
        style={{
          ...btnStyle,
          background: numClasses >= 2 ? 'var(--accent)' : 'var(--surface)',
          color: numClasses >= 2 ? 'var(--bg0)' : 'var(--text-muted)',
          border: numClasses >= 2 ? 'none' : '1px solid var(--border)',
          cursor: numClasses >= 2 && !training ? 'pointer' : 'default'
        }}
        onClick={handleTrain}
        disabled={numClasses < 2 || training || extracting || !featuresPath}
      >
        {training ? 'Training...' : '2. Train & Load'}
      </button>

      <button
        style={{ ...btnStyle, background: 'var(--surface)', color: 'var(--text)' }}
        onClick={handleLoadModel}
        disabled={extracting || training}
      >
        Load Existing Model
      </button>
      {classifierLoaded && classifierLabels.length > 0 && (
        <div style={{
          background: 'var(--bg3)',
          border: '1px solid var(--accent)',
          borderRadius: 4,
          padding: '6px 8px',
          marginBottom: 6
        }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600, marginBottom: 3 }}>
            Model loaded
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {classifierLabels.map((lbl) => (
              <span key={lbl} style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '1px 5px',
                color: 'var(--text)'
              }}>{lbl}</span>
            ))}
          </div>
        </div>
      )}
      {classifierLoaded && (
        <>
          <label style={{ ...labelStyle, marginBottom: 6 }}>
            Min confidence
            <input
              type="range"
              min={0}
              max={0.99}
              step={0.01}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              style={{ flex: 1, margin: '0 6px' }}
            />
            <span style={valStyle}>{Math.round(minConfidence * 100)}%</span>
          </label>
          <button
            style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--bg0)', border: 'none' }}
            onClick={handleClassify}
            disabled={classifying}
          >
            {classifying ? 'Classifying...' : 'Classify Selection'}
          </button>
        </>
      )}
      {classificationResults.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {classificationResults.length} frames classified
        </div>
      )}
      {statusMsg && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
          {statusMsg}
        </div>
      )}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4
}

const valStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text)',
  minWidth: 40,
  textAlign: 'right'
}
