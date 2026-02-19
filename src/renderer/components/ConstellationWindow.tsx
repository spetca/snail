import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useStore } from '../state/store'

type DecimateMode = 'factor' | 'rate' | 'selection'
type AnalysisMode = 'time' | 'ofdm'

export function ConstellationWindow(): React.ReactElement | null {
    const sampleRate = useStore((s) => s.sampleRate)
    const [cursorRange, setCursorRange] = useState<{ start: number, length: number, fs: number } | null>(null)
    const [rawData, setRawData] = useState<Float32Array | null>(null)

    // UI State
    const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('time')

    // CFO adjustments
    const [cfoCoarse, setCfoCoarse] = useState(0)
    const [cfoFine, setCfoFine] = useState(0)
    const [cfoCoarseInput, setCfoCoarseInput] = useState('0')
    const [cfoFineInput, setCfoFineInput] = useState('0')

    // Decimation
    const [decimateMode, setDecimateMode] = useState<DecimateMode>('factor')
    const [decimateFactor, setDecimateFactor] = useState(1)
    const [targetRateInput, setTargetRateInput] = useState('1000000')

    // OFDM Mode
    const [ofdmFftSize, setOfdmFftSize] = useState(1024)
    const [selectedBin, setSelectedBin] = useState(0)
    const [autoPick, setAutoPick] = useState(true)

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const miniFftRef = useRef<HTMLCanvasElement>(null)
    const MARGIN = 40

    // Listen for updates from main window
    useEffect(() => {
        return window.snailAPI.onConstellationUpdate((data: any) => {
            setCursorRange(data)
        })
    }, [])

    // Fetch raw samples when cursor range changes
    useEffect(() => {
        if (cursorRange) {
            const length = Math.min(cursorRange.length, 250000)
            window.snailAPI.getSamples(cursorRange.start, length).then(setRawData).catch(console.error)
        }
    }, [cursorRange])

    const fs = cursorRange?.fs || sampleRate
    const totalCfo = cfoCoarse + cfoFine

    // Parse target rate
    const targetRate = useMemo(() => {
        const parsed = Number(targetRateInput)
        return isNaN(parsed) || parsed <= 0 ? 1000000 : parsed
    }, [targetRateInput])

    // Update decimateFactor based on mode
    useEffect(() => {
        if (decimateMode === 'rate') {
            const factor = Math.max(1, Math.floor(fs / targetRate))
            setDecimateFactor(factor)
        } else if (decimateMode === 'selection' && cursorRange) {
            // "Time selection as 1 symbol" logic
            const factor = Math.max(1, Math.floor(cursorRange.length / ofdmFftSize))
            setDecimateFactor(factor)
        }
    }, [decimateMode, targetRate, fs, cursorRange, ofdmFftSize])

    // Correct raw data for CFO
    const correctedRaw = useMemo(() => {
        if (!rawData) return null
        const numSamples = rawData.length / 2
        const result = new Float32Array(rawData.length)
        const phaseInc = (2 * Math.PI * totalCfo) / fs

        for (let i = 0; i < numSamples; i++) {
            const iVal = rawData[i * 2]
            const qVal = rawData[i * 2 + 1]
            if (totalCfo === 0) {
                result[i * 2] = iVal
                result[i * 2 + 1] = qVal
            } else {
                const phase = phaseInc * i
                const cosP = Math.cos(phase)
                const sinP = Math.sin(phase)
                result[i * 2] = iVal * cosP - qVal * sinP
                result[i * 2 + 1] = iVal * sinP + qVal * cosP
            }
        }
        return result
    }, [rawData, totalCfo, fs])

    // Apply decimation to corrected data
    const decimatedStream = useMemo(() => {
        if (!correctedRaw) return null
        const decFactor = Math.max(1, Math.floor(decimateFactor))
        if (decFactor === 1) return correctedRaw

        const numSamples = Math.floor(correctedRaw.length / 2)
        const result = new Float32Array(Math.ceil(numSamples / decFactor) * 2)
        let outIdx = 0
        for (let i = 0; i < numSamples; i += decFactor) {
            result[outIdx * 2] = correctedRaw[i * 2]
            result[outIdx * 2 + 1] = correctedRaw[i * 2 + 1]
            outIdx++
        }
        return result
    }, [correctedRaw, decimateFactor])

    // OFDM Analysis Logic
    const ofdmAnalysis = useMemo(() => {
        if (!decimatedStream || analysisMode !== 'ofdm') return null

        const n = ofdmFftSize
        const numBlocks = Math.floor(decimatedStream.length / 2 / n)
        if (numBlocks === 0) return null

        const avgSpectrum = new Float32Array(n)

        // Prepare FFT buffers
        const re = new Float64Array(n)
        const im = new Float64Array(n)

        const extractedPoints = new Float32Array(numBlocks * 2)

        // Use a simpler DFT or FFT for accumulation
        // To keep it responsive, if numBlocks is large, we might limit it
        const maxBlocks = 512
        const actualBlocks = Math.min(numBlocks, maxBlocks)

        for (let b = 0; b < actualBlocks; b++) {
            for (let i = 0; i < n; i++) {
                re[i] = decimatedStream[(b * n + i) * 2]
                im[i] = decimatedStream[(b * n + i) * 2 + 1]
            }

            tsfft(re, im)

            for (let i = 0; i < n; i++) {
                const magSq = re[i] * re[i] + im[i] * im[i]
                avgSpectrum[i] += magSq
            }

            if (!autoPick) {
                const shiftedBin = (selectedBin + n) % n
                extractedPoints[b * 2] = re[shiftedBin] / n
                extractedPoints[b * 2 + 1] = im[shiftedBin] / n
            }
        }

        for (let i = 0; i < n; i++) {
            avgSpectrum[i] = 10 * Math.log10(avgSpectrum[i] / actualBlocks + 1e-12)
        }

        const displaySpectrum = new Float32Array(n)
        for (let i = 0; i < n; i++) {
            displaySpectrum[i] = avgSpectrum[(i + n / 2) % n]
        }

        let actualBin = selectedBin
        if (autoPick) {
            let maxVal = -Infinity
            let maxIdx = 0
            for (let i = 0; i < n; i++) {
                if (avgSpectrum[i] > maxVal) {
                    maxVal = avgSpectrum[i]; maxIdx = i
                }
            }
            actualBin = maxIdx
            // Re-extract since we didn't do it
            for (let b = 0; b < actualBlocks; b++) {
                let reBin = 0, imBin = 0;
                const angleScale = -2 * Math.PI * actualBin / n;
                for (let i = 0; i < n; i++) {
                    const r = decimatedStream[(b * n + i) * 2]
                    const c = decimatedStream[(b * n + i) * 2 + 1]
                    const ang = i * angleScale;
                    const cosW = Math.cos(ang), sinW = Math.sin(ang);
                    reBin += r * cosW - c * sinW;
                    imBin += r * sinW + c * cosW;
                }
                extractedPoints[b * 2] = reBin / n
                extractedPoints[b * 2 + 1] = imBin / n
            }
        }

        return { spectrum: displaySpectrum, points: extractedPoints, lockedBin: actualBin }
    }, [decimatedStream, analysisMode, ofdmFftSize, selectedBin, autoPick])

    // Final processed data for plotting
    const processedData = useMemo(() => {
        if (analysisMode === 'time') {
            return decimatedStream
        } else {
            return ofdmAnalysis?.points || null
        }
    }, [decimatedStream, analysisMode, ofdmAnalysis])

    const drawPlot = useCallback(() => {
        if (!canvasRef.current || !processedData) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const size = Math.min(canvas.clientWidth, canvas.clientHeight)
        canvas.width = size * dpr
        canvas.height = size * dpr
        ctx.scale(dpr, dpr)

        ctx.clearRect(0, 0, size, size)
        ctx.fillStyle = '#10141b'
        ctx.fillRect(0, 0, size, size)

        const plotSize = size - MARGIN * 2
        const center = size / 2

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
        ctx.lineWidth = 1
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        ctx.moveTo(MARGIN, center); ctx.lineTo(size - MARGIN, center)
        ctx.moveTo(center, MARGIN); ctx.lineTo(center, size - MARGIN)
        ctx.stroke()
        ctx.setLineDash([])

        let maxAmp = 0.01
        for (let i = 0; i < processedData.length; i++) {
            maxAmp = Math.max(maxAmp, Math.abs(processedData[i]))
        }
        maxAmp *= 1.1

        const scale = (plotSize / 2) / maxAmp
        ctx.strokeStyle = analysisMode === 'time' ? '#00f7c2' : '#4dabf7'
        ctx.lineWidth = 1

        const markSize = analysisMode === 'time' ? 2.5 : 3
        for (let i = 0; i < processedData.length / 2; i++) {
            const x = center + processedData[i * 2] * scale
            const y = center - processedData[i * 2 + 1] * scale
            ctx.beginPath()
            ctx.moveTo(x - markSize, y - markSize); ctx.lineTo(x + markSize, y + markSize)
            ctx.moveTo(x + markSize, y - markSize); ctx.lineTo(x - markSize, y + markSize)
            ctx.stroke()
        }
    }, [processedData, analysisMode])

    useEffect(() => {
        drawPlot()
    }, [drawPlot])

    // Draw Mini FFT
    useEffect(() => {
        if (!miniFftRef.current || !ofdmAnalysis) return
        const canvas = miniFftRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const spectrum = ofdmAnalysis.spectrum
        const n = spectrum.length

        let min = Infinity, max = -Infinity
        for (let i = 0; i < n; i++) {
            if (spectrum[i] < min) min = spectrum[i]
            if (spectrum[i] > max) max = spectrum[i]
        }
        const range = Math.max(20, max - min)
        const floor = max - range

        ctx.strokeStyle = '#4dabf7'
        ctx.beginPath()
        for (let i = 0; i < canvas.width; i++) {
            const idx = Math.floor(i * n / canvas.width)
            const val = spectrum[idx]
            const y = (1 - (val - floor) / range) * canvas.height
            if (i === 0) ctx.moveTo(i, y)
            else ctx.lineTo(i, y)
        }
        ctx.stroke()

        const binIdx = (ofdmAnalysis.lockedBin + n / 2) % n
        const binX = binIdx * canvas.width / n
        ctx.strokeStyle = '#ff922b'
        ctx.beginPath()
        ctx.moveTo(binX, 0); ctx.lineTo(binX, canvas.height)
        ctx.stroke()
    }, [ofdmAnalysis])

    const cfoCoarseLimit = fs * 0.1
    const cfoFineLimit = fs * 0.001

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Constellation</h3>
                    <div style={modeToggleStyle}>
                        <button
                            onClick={() => setAnalysisMode('time')}
                            style={analysisMode === 'time' ? activeModeStyle : inactiveModeStyle}
                        >Time</button>
                        <button
                            onClick={() => setAnalysisMode('ofdm')}
                            style={analysisMode === 'ofdm' ? activeModeStyle : inactiveModeStyle}
                        >OFDM</button>
                    </div>
                </div>
                {cursorRange && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Selection: {(cursorRange.length / fs).toExponential(2)}s | Target: {(fs / decimateFactor / 1e6).toFixed(2)} MHz
                    </span>
                )}
            </div>

            <div style={bodyStyle}>
                <div style={plotContainerStyle}>
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', maxWidth: 800, maxHeight: 800 }} />
                </div>

                <div style={sidebarStyle}>
                    {/* CFO Section */}
                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Coarse CFO (Hz)</label>
                        <input
                            type="range"
                            min={-cfoCoarseLimit}
                            max={cfoCoarseLimit}
                            step={1}
                            value={cfoCoarse}
                            onChange={(e) => {
                                const v = Number(e.target.value)
                                setCfoCoarse(v); setCfoCoarseInput(v.toString())
                            }}
                            style={{ width: '100%' }}
                        />
                        <input
                            type="text"
                            value={cfoCoarseInput}
                            onChange={(e) => {
                                setCfoCoarseInput(e.target.value)
                                const n = Number(e.target.value)
                                if (!isNaN(n)) setCfoCoarse(n)
                            }}
                            style={inputStyle}
                        />
                    </div>

                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Fine CFO (Hz)</label>
                        <input
                            type="range"
                            min={-cfoFineLimit}
                            max={cfoFineLimit}
                            step={0.1}
                            value={cfoFine}
                            onChange={(e) => {
                                const v = Number(e.target.value)
                                setCfoFine(v); setCfoFineInput(v.toString())
                            }}
                            style={{ width: '100%' }}
                        />
                        <input
                            type="text"
                            value={cfoFineInput}
                            onChange={(e) => {
                                setCfoFineInput(e.target.value)
                                const n = Number(e.target.value)
                                if (!isNaN(n)) setCfoFine(n)
                            }}
                            style={inputStyle}
                        />
                    </div>

                    <div style={sidebarSectionStyle}>
                        <div style={valDisplayStyle}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Total CFO</div>
                            {totalCfo.toFixed(2)} Hz
                        </div>
                        <button onClick={() => {
                            setCfoCoarse(0); setCfoFine(0);
                            setCfoCoarseInput('0'); setCfoFineInput('0');
                        }} style={smallBtnStyle}>Reset Offset</button>
                    </div>

                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />

                    {/* Decimation Section (Now always visible) */}
                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Decimation</label>
                        <div style={modeToggleStyle}>
                            <button onClick={() => setDecimateMode('factor')} style={decimateMode === 'factor' ? activeModeStyle : inactiveModeStyle}>Factor</button>
                            <button onClick={() => setDecimateMode('rate')} style={decimateMode === 'rate' ? activeModeStyle : inactiveModeStyle}>Rate</button>
                            <button onClick={() => setDecimateMode('selection')} style={decimateMode === 'selection' ? activeModeStyle : inactiveModeStyle}>Symbol</button>
                        </div>
                        {decimateMode === 'factor' && (
                            <select value={decimateFactor} onChange={(e) => setDecimateFactor(Number(e.target.value))} style={inputStyle}>
                                {[1, 2, 4, 8, 16, 32, 64, 128].map(opt => <option key={opt} value={opt}>{opt}x</option>)}
                            </select>
                        )}
                        {decimateMode === 'rate' && (
                            <input type="text" value={targetRateInput} onChange={(e) => setTargetRateInput(e.target.value)} style={inputStyle} placeholder="3.84e6" />
                        )}
                        {decimateMode === 'selection' && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', background: 'var(--bg3)', padding: 6, borderRadius: 4 }}>
                                Match selection to Nfft
                            </div>
                        )}
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', marginTop: 2 }}>
                            Factor: {decimateFactor}x
                        </div>
                    </div>

                    {analysisMode === 'ofdm' && (
                        <div style={sidebarSectionStyle}>
                            <label style={labelStyle}>OFDM Parameters</label>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>FFT Size</span>
                                <select
                                    value={ofdmFftSize}
                                    onChange={(e) => setOfdmFftSize(Number(e.target.value))}
                                    style={{ ...inputStyle, width: 80 }}
                                >
                                    {[64, 128, 256, 512, 1024, 2048, 4096].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>

                            <label style={{ ...labelStyle, marginTop: 12 }}>Pick Subcarrier</label>
                            <div
                                style={{ position: 'relative', width: '100%', height: 60, background: 'var(--bg3)', borderRadius: 4, cursor: 'crosshair' }}
                                onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const x = e.clientX - rect.left
                                    const binCenterIdx = Math.floor(x * ofdmFftSize / rect.width)
                                    const bin = (binCenterIdx - ofdmFftSize / 2 + ofdmFftSize) % ofdmFftSize
                                    setSelectedBin(bin)
                                    setAutoPick(false)
                                }}
                            >
                                <canvas ref={miniFftRef} width={200} height={60} style={{ width: '100%', height: '100%' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                <span style={{ fontSize: 11, color: '#ff922b', fontWeight: 600 }}>Bin: {ofdmAnalysis?.lockedBin}</span>
                                <button
                                    onClick={() => setAutoPick(true)}
                                    style={{ ...smallBtnStyle, background: autoPick ? 'var(--accent)' : 'var(--bg3)', color: autoPick ? 'var(--bg0)' : 'var(--text)' }}
                                >{autoPick ? 'Locked Peak' : 'Unlock'}</button>
                            </div>
                        </div>
                    )}

                    <div style={{ ...sidebarSectionStyle, marginTop: 'auto' }}>
                        <div style={infoRowStyle}>
                            <span>Points:</span>
                            <span>{processedData ? (processedData.length / 2).toLocaleString() : 0}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function tsfft(re: Float64Array, im: Float64Array) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]]
            [im[i], im[j]] = [im[j], im[i]]
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len
        const wlen_re = Math.cos(ang), wlen_im = Math.sin(ang)
        for (let i = 0; i < n; i += len) {
            let w_re = 1, w_im = 0
            for (let j = 0; j < len / 2; j++) {
                const tr = re[i + j + len / 2] * w_re - im[i + j + len / 2] * w_im
                const ti = re[i + j + len / 2] * w_im + im[i + j + len / 2] * w_re
                re[i + j + len / 2] = re[i + j] - tr
                im[i + j + len / 2] = im[i + j] - ti
                re[i + j] += tr
                im[i + j] += ti
                const tmp = w_re * wlen_re - w_im * wlen_im
                w_im = w_re * wlen_im + w_im * wlen_re
                w_re = tmp
            }
        }
    }
}

const containerStyle: React.CSSProperties = {
    width: '100vw', height: '100vh', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', overflow: 'hidden'
}
const headerStyle: React.CSSProperties = {
    padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg2)'
}
const bodyStyle: React.CSSProperties = { flex: 1, display: 'flex', overflow: 'hidden' }
const plotContainerStyle: React.CSSProperties = {
    flex: 1, background: '#0a0e14', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
}
const sidebarStyle: React.CSSProperties = {
    width: 240, background: 'var(--bg2)', borderLeft: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto'
}
const sidebarSectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em'
}
const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 4, outline: 'none', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center'
}
const modeToggleStyle: React.CSSProperties = { display: 'flex', background: 'var(--bg3)', borderRadius: 4, padding: 2, gap: 2 }
const activeModeStyle: React.CSSProperties = {
    flex: 1, background: 'var(--accent)', color: 'var(--bg0)', border: 'none', borderRadius: 3, fontSize: 10, fontWeight: 700, padding: '4px 0', cursor: 'pointer'
}
const inactiveModeStyle: React.CSSProperties = {
    flex: 1, background: 'transparent', color: 'var(--text-muted)', border: 'none', borderRadius: 3, fontSize: 10, padding: '4px 0', cursor: 'pointer'
}
const infoRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }
const valDisplayStyle: React.CSSProperties = {
    fontSize: 14, fontFamily: 'var(--font-mono)', textAlign: 'center', background: 'rgba(0, 247, 194, 0.05)', padding: '8px', borderRadius: 4, border: '1px solid rgba(0, 247, 194, 0.2)', color: '#00f7c2'
}
const smallBtnStyle: React.CSSProperties = {
    padding: '4px 8px', fontSize: 10, borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600
}
