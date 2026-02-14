import React, { useRef, useEffect, useCallback } from 'react'
import { useStore } from '../state/store'
import type { SampleFormat } from '../../shared/sample-formats'

const PREVIEW_HEIGHT = 100
const PLOT_HEIGHT = 80
const DEBOUNCE_MS = 500

const FORMATS: SampleFormat[] = [
  'cf32', 'cf64', 'cs32', 'cs16', 'cs8', 'cu8',
  'rf32', 'rf64', 'rs16', 'rs8', 'ru8'
]

export function CorrelationPane(): React.ReactElement {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const plotCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const computeGenRef = useRef(0)

  const correlationEnabled = useStore((s) => s.correlationEnabled)
  const correlationMode = useStore((s) => s.correlationMode)
  const correlationFilePath = useStore((s) => s.correlationFilePath)
  const correlationFileFormat = useStore((s) => s.correlationFileFormat)
  const correlationData = useStore((s) => s.correlationData)
  const correlationLoading = useStore((s) => s.correlationLoading)
  const setCorrelationMode = useStore((s) => s.setCorrelationMode)
  const setCorrelationFilePath = useStore((s) => s.setCorrelationFilePath)
  const setCorrelationFileFormat = useStore((s) => s.setCorrelationFileFormat)
  const setCorrelationData = useStore((s) => s.setCorrelationData)
  const setCorrelationLoading = useStore((s) => s.setCorrelationLoading)
  const tu = useStore((s) => s.tu)
  const cpLen = useStore((s) => s.cpLen)
  const setTu = useStore((s) => s.setTu)
  const setCpLen = useStore((s) => s.setCpLen)
  const sampleRate = useStore((s) => s.sampleRate)
  const cursors = useStore((s) => s.cursors)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)

  // Local state for flexible input
  const [inputMode, setInputMode] = React.useState<'samples' | 'time'>('samples')
  const [tuText, setTuText] = React.useState(tu.toString())
  const [cpText, setCpText] = React.useState(cpLen.toString())

  // Sync text when tu/cp changes from outside (e.g. store reset or mode toggle)
  useEffect(() => {
    const currentTuVal = inputMode === 'samples' ? tu : tu / sampleRate
    const currentCpVal = inputMode === 'samples' ? cpLen : cpLen / sampleRate

    // Only update if the parsed value in the text box differs from the store
    // This prevents "snapping" while typing (e.g. typing '66.6' -> '66.600e-6')
    if (parseFloat(tuText) !== currentTuVal) {
      setTuText(inputMode === 'samples' ? tu.toString() : (tu / sampleRate).toExponential(3))
    }
    if (parseFloat(cpText) !== currentCpVal) {
      setCpText(inputMode === 'samples' ? cpLen.toString() : (cpLen / sampleRate).toExponential(3))
    }
  }, [tu, cpLen, inputMode, sampleRate])

  const handleTuChange = (val: string) => {
    setTuText(val)
    const num = parseFloat(val)
    if (!isNaN(num) && isFinite(num)) {
      setTu(Math.round(inputMode === 'time' ? num * sampleRate : num))
    }
  }

  const handleCpChange = (val: string) => {
    setCpText(val)
    const num = parseFloat(val)
    if (!isNaN(num) && isFinite(num)) {
      setCpLen(Math.round(inputMode === 'time' ? num * sampleRate : num))
    }
  }

  // Compute search window from X cursors
  const samplesPerPixel = fftSize / zoomLevel
  const windowStart = Math.round(
    scrollOffset + Math.min(cursors.x1, cursors.x2) * samplesPerPixel
  )
  const windowLength = Math.max(
    1024,
    Math.round(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel)
  )

  const handleLoadFile = useCallback(async () => {
    const path = await window.snailAPI.showOpenDialog()
    if (path) setCorrelationFilePath(path)
  }, [setCorrelationFilePath])

  // Auto-compute correlation (debounced) when inputs change
  useEffect(() => {
    if (!correlationEnabled || !cursors.enabled) return
    if (correlationMode === 'file' && !correlationFilePath) return
    if (Math.abs(cursors.x2 - cursors.x1) < 5) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      const gen = ++computeGenRef.current
      setCorrelationLoading(true)
      try {
        const result = await window.snailAPI.correlate({
          mode: correlationMode,
          windowStart,
          windowLength,
          patternFilePath: correlationFilePath || undefined,
          patternFileFormat: correlationFileFormat,
          tu,
          cpLen
        })
        if (computeGenRef.current === gen) {
          setCorrelationData(result)
        }
      } catch (err) {
        console.error('Correlation failed:', err)
        if (computeGenRef.current === gen) {
          setCorrelationData(null)
        }
      } finally {
        if (computeGenRef.current === gen) {
          setCorrelationLoading(false)
        }
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [
    correlationEnabled, correlationMode, correlationFilePath, correlationFileFormat,
    cursors.enabled, cursors.x1, cursors.x2,
    windowStart, windowLength, tu, cpLen,
    setCorrelationData, setCorrelationLoading
  ])

  // Draw pattern file time-domain waveform (I/Q like TracePlot)
  useEffect(() => {
    const canvas = previewCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !correlationFilePath) return

    const rect = container.getBoundingClientRect()
    const width = rect.width
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = PREVIEW_HEIGHT * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${PREVIEW_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, PREVIEW_HEIGHT)
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, width, PREVIEW_HEIGHT)

    // Read the entire pattern file (or enough samples to fill the canvas)
    // We'll request enough to render one sample per pixel at minimum
    const maxSamples = Math.max(width * 4, 65536)

    window.snailAPI.readFileSamples(correlationFilePath, correlationFileFormat, 0, maxSamples)
      .then((samples) => {
        if (!samples || samples.length === 0) return

        const totalSamples = samples.length / 2 // interleaved I/Q
        const samplesPerPx = totalSamples / width
        const midY = PREVIEW_HEIGHT / 2
        const scale = PREVIEW_HEIGHT / 4

        // I channel (red, like TracePlot)
        ctx.strokeStyle = '#ff6b6b'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px < width; px++) {
          const idx = Math.floor(px * samplesPerPx) * 2
          if (idx >= samples.length) break
          const y = midY - samples[idx] * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Q channel (blue, like TracePlot)
        ctx.strokeStyle = '#4dabf7'
        ctx.beginPath()
        for (let px = 0; px < width; px++) {
          const idx = Math.floor(px * samplesPerPx) * 2 + 1
          if (idx >= samples.length) break
          const y = midY - samples[idx] * scale
          if (px === 0) ctx.moveTo(px, y)
          else ctx.lineTo(px, y)
        }
        ctx.stroke()

        // Labels
        ctx.font = '10px "JetBrains Mono", monospace'
        ctx.fillStyle = '#ff6b6b'
        ctx.fillText('I', 6, 14)
        ctx.fillStyle = '#4dabf7'
        ctx.fillText('Q', 6, 28)
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        const fileName = correlationFilePath.split('/').pop() || 'Pattern'
        ctx.fillText(`Pattern: ${fileName} (${totalSamples} samples)`, 24, 14)
      })
      .catch((err) => {
        ctx.font = '11px "JetBrains Mono", monospace'
        ctx.fillStyle = '#ff6b6b'
        ctx.fillText(`Error reading file: ${err.message}`, 6, PREVIEW_HEIGHT / 2 + 4)
      })
  }, [correlationFilePath, correlationFileFormat])

  // Draw correlation magnitude plot
  useEffect(() => {
    const canvas = plotCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const width = rect.width
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = PLOT_HEIGHT * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${PLOT_HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, PLOT_HEIGHT)
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, width, PLOT_HEIGHT)

    if (!correlationData) {
      ctx.font = '11px "JetBrains Mono", monospace'
      if (correlationLoading) {
        ctx.fillStyle = '#FFD700'
        ctx.fillText('Computing correlation...', 6, PLOT_HEIGHT / 2 + 4)
      } else if (correlationMode === 'file' && !correlationFilePath) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.fillText('Load a pattern file and set X cursors to compute', 6, PLOT_HEIGHT / 2 + 4)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.fillText('Set X cursors to compute self-correlation', 6, PLOT_HEIGHT / 2 + 4)
      }
      return
    }

    // Find max for normalization
    let maxVal = 0
    for (let i = 0; i < correlationData.length; i++) {
      if (correlationData[i] > maxVal) maxVal = correlationData[i]
    }
    if (maxVal === 0) return

    const totalLags = correlationData.length

    // Draw correlation magnitude (already abs from native sqrt(re^2+im^2))
    ctx.strokeStyle = '#00e5a0'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let px = 0; px < width; px++) {
      const lagIdx = Math.floor((px / width) * totalLags)
      if (lagIdx >= totalLags) break
      const normalized = correlationData[lagIdx] / maxVal
      const y = PLOT_HEIGHT - 4 - normalized * (PLOT_HEIGHT - 8)
      if (px === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()

    // Find and mark peak
    let peakIdx = 0
    let peakVal = 0
    for (let i = 0; i < totalLags; i++) {
      if (correlationData[i] > peakVal) {
        peakVal = correlationData[i]
        peakIdx = i
      }
    }

    // In full linear mode, index 0 is lag -(patternLen - 1)
    // patternLen = totalLags - windowLength + 1
    const patternLen = totalLags - windowLength + 1
    const lag = peakIdx - (patternLen - 1)

    const peakX = (peakIdx / totalLags) * width
    ctx.strokeStyle = '#FFD700'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(peakX, 0)
    ctx.lineTo(peakX, PLOT_HEIGHT)
    ctx.stroke()
    ctx.setLineDash([])

    // Labels
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#00e5a0'
    ctx.fillText('|Correlation|', 6, 14)
    ctx.fillStyle = '#FFD700'
    ctx.fillText(`Peak at lag ${lag} (rho: ${peakVal.toFixed(3)})`, 6, 28)
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    if (correlationMode === 'file') {
      ctx.fillText(
        `Full linear slide: [-${patternLen - 1}, +${windowLength - 1}] relative to window ${windowStart}`,
        6, PLOT_HEIGHT - 6
      )
    } else {
      ctx.fillText(
        `Self-Correlation: Tu=${tu}, CP=${cpLen} within window ${windowStart}`,
        6, PLOT_HEIGHT - 6
      )
    }
  }, [correlationData, correlationLoading, correlationFilePath, windowStart, windowLength])

  if (!correlationEnabled) return <></>

  return (
    <div
      ref={containerRef}
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg1)',
        marginRight: 72,
        flexShrink: 0
      }}
    >
      {/* Controls bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          background: 'var(--bg2)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11
        }}
      >
        <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Correlation</span>

        <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', borderRadius: 4, padding: 2 }}>
          {(['file', 'self'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setCorrelationMode(mode)}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: correlationMode === mode ? 'var(--accent)' : 'transparent',
                color: correlationMode === mode ? 'var(--bg0)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 2
              }}
            >
              {mode === 'file' ? 'File' : 'Self'}
            </button>
          ))}
        </div>

        {correlationMode === 'file' ? (
          <>
            <button
              onClick={handleLoadFile}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {correlationFilePath ? 'Change File' : 'Load Pattern File'}
            </button>
            {correlationFilePath && (
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {correlationFilePath.split('/').pop()}
              </span>
            )}
            <select
              value={correlationFileFormat}
              onChange={(e) => setCorrelationFileFormat(e.target.value as SampleFormat)}
              style={{ fontSize: 11, padding: '2px 4px' }}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', borderRadius: 4, padding: 2 }}>
              {(['samples', 'time'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setInputMode(m)}
                  style={{
                    fontSize: 9,
                    padding: '1px 4px',
                    background: inputMode === m ? 'var(--bg0)' : 'transparent',
                    color: inputMode === m ? 'var(--text)' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 2
                  }}
                >
                  {m === 'samples' ? 'Smpl' : 'Time'}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Tu:</span>
              <input
                type="text"
                value={tuText}
                onChange={(e) => handleTuChange(e.target.value)}
                style={{ width: 70, fontSize: 10, padding: '1px 4px', fontFamily: 'var(--font-mono)' }}
                placeholder={inputMode === 'samples' ? 'Samples' : 'e.g. 66e-6'}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>CP:</span>
              <input
                type="text"
                value={cpText}
                onChange={(e) => handleCpChange(e.target.value)}
                style={{ width: 70, fontSize: 10, padding: '1px 4px', fontFamily: 'var(--font-mono)' }}
                placeholder={inputMode === 'samples' ? 'Samples' : 'e.g. 16e-6'}
              />
            </label>

            <div style={{
              fontSize: 10,
              color: 'var(--accent)',
              fontFamily: 'serif',
              fontStyle: 'italic',
              background: 'rgba(0,229,160,0.05)',
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid rgba(0,229,160,0.1)'
            }}>
              Schmidl & Cox: ρ(d) = |Σ x[d+m] x*[d+m+Tu]| / √(Σ|x[d+m]|² Σ|x[d+m+Tu]|²)
            </div>
          </div>
        )}
        {correlationLoading && (
          <span style={{ color: '#FFD700', fontSize: 10 }}>Computing...</span>
        )}
        {!cursors.enabled && (
          <span style={{ color: 'var(--error)', fontSize: 10 }}>
            Enable cursors to set search window
          </span>
        )}
        {cursors.enabled && Math.abs(cursors.x2 - cursors.x1) < 5 && (
          <span style={{ color: 'var(--error)', fontSize: 10 }}>
            Set X cursors to define search window
          </span>
        )}
      </div>

      {/* Pattern file I/Q time-domain preview */}
      {correlationFilePath && (
        <div style={{ height: PREVIEW_HEIGHT, borderBottom: '1px solid var(--border)' }}>
          <canvas ref={previewCanvasRef} />
        </div>
      )}

      {/* Correlation magnitude plot */}
      <div style={{ height: PLOT_HEIGHT }}>
        <canvas ref={plotCanvasRef} />
      </div>
    </div>
  )
}
