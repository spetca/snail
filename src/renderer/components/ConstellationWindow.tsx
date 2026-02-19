import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useStore } from '../state/store'

type DecimateMode = 'factor' | 'rate'

export function ConstellationWindow(): React.ReactElement | null {
    const sampleRate = useStore((s) => s.sampleRate)
    const [cursorRange, setCursorRange] = useState<{ start: number, length: number, fs: number } | null>(null)
    const [rawData, setRawData] = useState<Float32Array | null>(null)

    // CFO adjustments
    const [cfoCoarse, setCfoCoarse] = useState(0)
    const [cfoFine, setCfoFine] = useState(0)
    const [cfoCoarseInput, setCfoCoarseInput] = useState('0')
    const [cfoFineInput, setCfoFineInput] = useState('0')

    // Decimation
    const [decimateMode, setDecimateMode] = useState<DecimateMode>('factor')
    const [decimateFactor, setDecimateFactor] = useState(1)
    const [targetRateInput, setTargetRateInput] = useState('1000000')

    const canvasRef = useRef<HTMLCanvasElement>(null)
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
            const length = Math.min(cursorRange.length, 100000)
            window.snailAPI.getSamples(cursorRange.start, length).then(setRawData).catch(console.error)
        }
    }, [cursorRange])

    const fs = cursorRange?.fs || sampleRate
    const totalCfo = cfoCoarse + cfoFine

    // Parse target rate from input (handles scientific notation like 3.84e6)
    const targetRate = useMemo(() => {
        const parsed = Number(targetRateInput)
        return isNaN(parsed) || parsed <= 0 ? 1000000 : parsed
    }, [targetRateInput])

    useEffect(() => {
        if (decimateMode === 'rate') {
            const factor = Math.max(1, Math.floor(fs / targetRate))
            setDecimateFactor(factor)
        }
    }, [decimateMode, targetRate, fs])

    // Apply CFO and decimation
    const processedData = useMemo(() => {
        if (!rawData) return null

        const decFactor = Math.max(1, Math.floor(decimateFactor))
        const numSamples = Math.floor(rawData.length / 2)
        const result = new Float32Array(Math.ceil(numSamples / decFactor) * 2)

        let outIdx = 0
        const phaseInc = (2 * Math.PI * totalCfo) / fs

        for (let i = 0; i < numSamples; i += decFactor) {
            const iVal = rawData[i * 2]
            const qVal = rawData[i * 2 + 1]

            if (totalCfo === 0) {
                result[outIdx * 2] = iVal
                result[outIdx * 2 + 1] = qVal
            } else {
                const phase = phaseInc * i
                const cosP = Math.cos(phase)
                const sinP = Math.sin(phase)
                result[outIdx * 2] = iVal * cosP - qVal * sinP
                result[outIdx * 2 + 1] = iVal * sinP + qVal * cosP
            }
            outIdx++
        }
        return result
    }, [rawData, totalCfo, decimateFactor, fs])

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
        ctx.fillStyle = '#10141b' // Slightly darker
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

        ctx.strokeStyle = '#00f7c2' // Brighter accent
        ctx.lineWidth = 1

        const markSize = 2.5
        for (let i = 0; i < processedData.length / 2; i++) {
            const x = center + processedData[i * 2] * scale
            const y = center - processedData[i * 2 + 1] * scale

            ctx.beginPath()
            ctx.moveTo(x - markSize, y - markSize)
            ctx.lineTo(x + markSize, y + markSize)
            ctx.moveTo(x + markSize, y - markSize)
            ctx.lineTo(x - markSize, y + markSize)
            ctx.stroke()
        }

    }, [processedData])

    useEffect(() => {
        drawPlot()
    }, [drawPlot])

    const cfoCoarseLimit = fs * 0.1
    const cfoFineLimit = fs * 0.001 // Fine is 0.1% of FS

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Constellation Analysis</h3>
                {cursorRange && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Selection: {(cursorRange.length / fs).toExponential(2)}s | Rates: {(fs / 1e6).toFixed(2)} {'->'} {(fs / decimateFactor / 1e6).toFixed(2)} MHz
                    </span>
                )}
            </div>

            <div style={bodyStyle}>
                <div style={plotContainerStyle}>
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', maxWidth: 800, maxHeight: 800 }} />
                </div>

                <div style={sidebarStyle}>
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
                                setCfoCoarse(v)
                                setCfoCoarseInput(v.toString())
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
                                setCfoFine(v)
                                setCfoFineInput(v.toString())
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

                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Decimation Mode</label>
                        <div style={modeToggleStyle}>
                            <button
                                onClick={() => setDecimateMode('factor')}
                                style={decimateMode === 'factor' ? activeModeStyle : inactiveModeStyle}
                            >Factor</button>
                            <button
                                onClick={() => setDecimateMode('rate')}
                                style={decimateMode === 'rate' ? activeModeStyle : inactiveModeStyle}
                            >Target Rate</button>
                        </div>

                        {decimateMode === 'factor' ? (
                            <select
                                value={decimateFactor}
                                onChange={(e) => setDecimateFactor(Number(e.target.value))}
                                style={inputStyle}
                            >
                                {[1, 2, 4, 8, 16, 32, 64, 128].map(opt => (
                                    <option key={opt} value={opt}>{opt}x</option>
                                ))}
                            </select>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <input
                                    type="text"
                                    value={targetRateInput}
                                    onChange={(e) => setTargetRateInput(e.target.value)}
                                    style={inputStyle}
                                    placeholder="e.g. 3.84e6"
                                />
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
                                    Factor: {decimateFactor}x
                                </div>
                            </div>
                        )}
                    </div>

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

const containerStyle: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    background: 'var(--bg1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
}

const headerStyle: React.CSSProperties = {
    padding: '12px 20px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--bg2)'
}

const bodyStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    overflow: 'hidden'
}

const plotContainerStyle: React.CSSProperties = {
    flex: 1,
    background: '#0a0e14',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
}

const sidebarStyle: React.CSSProperties = {
    width: 240,
    background: 'var(--bg2)',
    borderLeft: '1px solid var(--border)',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto'
}

const sidebarSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
}

const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '6px 8px',
    borderRadius: 4,
    outline: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    textAlign: 'center'
}

const modeToggleStyle: React.CSSProperties = {
    display: 'flex',
    background: 'var(--bg3)',
    borderRadius: 4,
    padding: 2,
    gap: 2
}

const activeModeStyle: React.CSSProperties = {
    flex: 1,
    background: 'var(--accent)',
    color: 'var(--bg0)',
    border: 'none',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 0',
    cursor: 'pointer'
}

const inactiveModeStyle: React.CSSProperties = {
    flex: 1,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    borderRadius: 3,
    fontSize: 10,
    padding: '4px 0',
    cursor: 'pointer'
}

const infoRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-muted)'
}

const valDisplayStyle: React.CSSProperties = {
    fontSize: 14,
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
    background: 'rgba(0, 247, 194, 0.05)',
    padding: '8px',
    borderRadius: 4,
    border: '1px solid rgba(0, 247, 194, 0.2)',
    color: '#00f7c2'
}

const smallBtnStyle: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: 10,
    borderRadius: 3,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontWeight: 600
}
