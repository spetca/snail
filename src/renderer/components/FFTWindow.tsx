import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../state/store'
import { formatFrequency } from '../../shared/units'

export function FFTWindow(): React.ReactElement | null {
    const fftSettings = useStore((s) => s.fftSettings)
    const setFFTSettings = useStore((s) => s.setFFTSettings)
    const fftResult = useStore((s) => s.fftResult)
    const setFFTResult = useStore((s) => s.setFFTResult)
    const sampleRate = useStore((s) => s.sampleRate)

    const fftCursors = useStore((s) => s.fftCursors)
    const setFFTCursorsEnabled = useStore((s) => s.setFFTCursorsEnabled)
    const setFFTCursorV = useStore((s) => s.setFFTCursorV)
    const setFFTCursorH = useStore((s) => s.setFFTCursorH)

    const [cursorRange, setCursorRange] = useState<{ start: number, length: number, fs: number } | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [dragTarget, setDragTarget] = useState<'v1' | 'v2' | 'h1' | 'h2' | null>(null)

    const MARGIN = { top: 40, right: 80, bottom: 40, left: 60 }

    // Listen for updates from main window
    useEffect(() => {
        return window.snailAPI.onFFTUpdate((data: any) => {
            setCursorRange(data)
        })
    }, [])

    useEffect(() => {
        if (cursorRange) {
            const fs = fftSettings.fs || cursorRange.fs || sampleRate
            window.snailAPI.computeFFT({
                startSample: cursorRange.start,
                length: cursorRange.length,
                fftSize: fftSettings.fftSize,
                window: fftSettings.window,
                shift: fftSettings.shift,
                scale: fftSettings.scale,
                sampleRate: fs
            }).then(setFFTResult).catch(console.error)
        }
    }, [
        cursorRange?.start,
        cursorRange?.length,
        cursorRange?.fs,
        fftSettings.fftSize,
        fftSettings.window,
        fftSettings.shift,
        fftSettings.scale,
        fftSettings.fs,
        sampleRate
    ])

    const drawPlot = useCallback(() => {
        if (!fftResult || !canvasRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = '#0a0e14'
        ctx.fillRect(0, 0, width, height)

        const plotWidth = width - MARGIN.left - MARGIN.right
        const plotHeight = height - MARGIN.top - MARGIN.bottom

        const data = fftResult.data
        const n = data.length

        // Y Axis Range
        const isLog = fftSettings.scale === 'log'
        const minP = isLog ? -120 : 0
        const maxP = isLog ? 0 : (fftResult.maxPower || 1) * 1.1

        const getY = (val: number) => {
            const norm = (val - minP) / (maxP - minP)
            return MARGIN.top + plotHeight - norm * plotHeight
        }

        const getX = (norm: number) => MARGIN.left + norm * plotWidth

        // Grid - Horizontal (Power)
        ctx.font = '10px "JetBrains Mono", monospace'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'

        const numTicksY = 10
        for (let i = 0; i <= numTicksY; i++) {
            const p = minP + (maxP - minP) * (i / numTicksY)
            const y = getY(p)

            ctx.strokeStyle = i === 0 || i === numTicksY ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)'
            ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + plotWidth, y); ctx.stroke()

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
            ctx.beginPath(); ctx.moveTo(MARGIN.left - 5, y); ctx.lineTo(MARGIN.left, y); ctx.stroke()

            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
            ctx.fillText(p.toFixed(0), MARGIN.left - 8, y)
        }

        // Grid - Vertical (Freq)
        const fs = fftSettings.fs || cursorRange?.fs || sampleRate
        const fMin = fftSettings.shift ? -fs / 2 : 0
        const fMax = fftSettings.shift ? fs / 2 : fs
        const numTicksX = 10

        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        for (let i = 0; i <= numTicksX; i++) {
            const norm = i / numTicksX
            const f = fMin + (fMax - fMin) * norm
            const x = getX(norm)

            ctx.strokeStyle = i === 0 || i === numTicksX ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)'
            ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + plotHeight); ctx.stroke()

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
            ctx.beginPath(); ctx.moveTo(x, MARGIN.top + plotHeight); ctx.lineTo(x, MARGIN.top + plotHeight + 5); ctx.stroke()

            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
            ctx.fillText(formatFrequency(f), x, MARGIN.top + plotHeight + 8)
        }

        // Data Plot
        ctx.strokeStyle = '#00d4aa'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
            const x = getX(i / (n - 1))
            const y = getY(data[i])
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.stroke()

        // Cursors
        if (fftCursors.enabled) {
            ctx.lineWidth = 1

            // Vertical Cursors
            const renderVCursor = (v: number, label: string) => {
                const x = getX(v)
                ctx.strokeStyle = '#4dabf7'
                ctx.setLineDash([4, 4])
                ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + plotHeight); ctx.stroke()
                ctx.setLineDash([])

                ctx.fillStyle = '#4dabf7'
                ctx.textAlign = 'center'
                ctx.fillText(label, x, MARGIN.top - 15)
            }
            renderVCursor(fftCursors.v1, 'V1')
            renderVCursor(fftCursors.v2, 'V2')

            // Horizontal Cursors
            const renderHCursor = (h: number, label: string) => {
                const y = MARGIN.top + h * plotHeight
                ctx.strokeStyle = '#ff6b6b'
                ctx.setLineDash([4, 4])
                ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(MARGIN.left + plotWidth, y); ctx.stroke()
                ctx.setLineDash([])

                ctx.fillStyle = '#ff6b6b'
                ctx.textAlign = 'left'
                ctx.textBaseline = 'middle'
                ctx.fillText(label, MARGIN.left + plotWidth + 8, y)
            }
            renderHCursor(fftCursors.h1, 'H1')
            renderHCursor(fftCursors.h2, 'H2')
        }

    }, [fftResult, fftSettings, fftCursors, cursorRange, sampleRate])

    useEffect(() => {
        drawPlot()
    }, [drawPlot])

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!fftCursors.enabled || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width
        const y = (e.clientY - rect.top) / rect.height

        const width = canvasRef.current.clientWidth
        const height = canvasRef.current.clientHeight
        const plotWidth = width - MARGIN.left - MARGIN.right
        const plotHeight = height - MARGIN.top - MARGIN.bottom

        const nx = (x * width - MARGIN.left) / plotWidth
        const ny = (y * height - MARGIN.top) / plotHeight

        const threshold = 0.05
        if (Math.abs(nx - fftCursors.v1) < threshold) setDragTarget('v1')
        else if (Math.abs(nx - fftCursors.v2) < threshold) setDragTarget('v2')
        else if (Math.abs(ny - fftCursors.h1) < threshold) setDragTarget('h1')
        else if (Math.abs(ny - fftCursors.h2) < threshold) setDragTarget('h2')
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!dragTarget || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width
        const y = (e.clientY - rect.top) / rect.height

        const width = canvasRef.current.clientWidth
        const height = canvasRef.current.clientHeight
        const plotWidth = width - MARGIN.left - MARGIN.right
        const plotHeight = height - MARGIN.top - MARGIN.bottom

        const nx = Math.max(0, Math.min(1, (x * width - MARGIN.left) / plotWidth))
        const ny = Math.max(0, Math.min(1, (y * height - MARGIN.top) / plotHeight))

        if (dragTarget === 'v1') setFFTCursorV(nx, fftCursors.v2)
        else if (dragTarget === 'v2') setFFTCursorV(fftCursors.v1, nx)
        else if (dragTarget === 'h1') setFFTCursorH(ny, fftCursors.h2)
        else if (dragTarget === 'h2') setFFTCursorH(fftCursors.h1, ny)
    }

    const handleMouseUp = () => setDragTarget(null)

    // Measurements
    const fs = fftSettings.fs || cursorRange?.fs || sampleRate
    const fMin = fftSettings.shift ? -fs / 2 : 0
    const fMax = fftSettings.shift ? fs / 2 : fs
    const f1 = fMin + fftCursors.v1 * (fMax - fMin)
    const f2 = fMin + fftCursors.v2 * (fMax - fMin)

    const isLog = fftSettings.scale === 'log'
    const minP = isLog ? -120 : 0
    const maxP = isLog ? 0 : (fftResult?.maxPower || 1) * 1.1
    const p1 = maxP - fftCursors.h1 * (maxP - minP)
    const p2 = maxP - fftCursors.h2 * (maxP - minP)

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>FFT Analysis</h3>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={fftCursors.enabled}
                            onChange={e => setFFTCursorsEnabled(e.target.checked)}
                        />
                        Measurement Cursors
                    </label>
                </div>
                {!cursorRange && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Waiting for cursor selection...</span>}
            </div>

            <div style={bodyStyle}>
                <div style={plotContainerStyle}>
                    <canvas
                        ref={canvasRef}
                        style={{ width: '100%', height: '100%', cursor: dragTarget ? 'grabbing' : 'auto' }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />
                </div>

                <div style={sidebarStyle}>
                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>FFT Bins</label>
                        <select
                            value={fftSettings.fftSize}
                            onChange={e => setFFTSettings({ fftSize: Number(e.target.value) })}
                            style={selectStyle}
                        >
                            {[256, 512, 1024, 2048, 4096, 8192, 16384, 32768].map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Window</label>
                        <select
                            value={fftSettings.window}
                            onChange={e => setFFTSettings({ window: e.target.value as any })}
                            style={selectStyle}
                        >
                            <option value="none">None (Rectangular)</option>
                            <option value="hann">Hann</option>
                            <option value="hamming">Hamming</option>
                            <option value="blackman">Blackman</option>
                        </select>
                    </div>

                    <div style={sidebarSectionStyle}>
                        <label style={checkboxLabelStyle}>
                            <input
                                type="checkbox"
                                checked={fftSettings.shift}
                                onChange={e => setFFTSettings({ shift: e.target.checked })}
                            />
                            FFT Shift
                        </label>
                    </div>

                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Scale</label>
                        <div style={btnGroupStyle}>
                            <button
                                onClick={() => setFFTSettings({ scale: 'log' })}
                                style={{ ...toggleBtnStyle, background: fftSettings.scale === 'log' ? 'var(--accent)' : 'var(--bg3)' }}
                            >Log (dB)</button>
                            <button
                                onClick={() => setFFTSettings({ scale: 'abs' })}
                                style={{ ...toggleBtnStyle, background: fftSettings.scale === 'abs' ? 'var(--accent)' : 'var(--bg3)' }}
                            >Abs</button>
                        </div>
                    </div>

                    <div style={sidebarSectionStyle}>
                        <label style={labelStyle}>Sample Rate (Hz)</label>
                        <input
                            type="number"
                            value={fftSettings.fs || cursorRange?.fs || sampleRate}
                            onChange={e => setFFTSettings({ fs: Number(e.target.value) })}
                            style={inputStyle}
                        />
                    </div>

                    {fftCursors.enabled && (
                        <div style={{ ...sidebarSectionStyle, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                            <label style={labelStyle}>Measurements</label>
                            <div style={measBlockStyle}>
                                <div style={statRowStyle}><span>V1:</span> <span>{formatFrequency(f1)}</span></div>
                                <div style={statRowStyle}><span>V2:</span> <span>{formatFrequency(f2)}</span></div>
                                <div style={{ ...statRowStyle, color: 'var(--accent)' }}>
                                    <span>ΔV:</span> <span>{formatFrequency(Math.abs(f1 - f2))}</span>
                                </div>
                            </div>
                            <div style={measBlockStyle}>
                                <div style={statRowStyle}><span>H1:</span> <span>{p1.toFixed(1)} {isLog ? 'dB' : ''}</span></div>
                                <div style={statRowStyle}><span>H2:</span> <span>{p2.toFixed(1)} {isLog ? 'dB' : ''}</span></div>
                                <div style={{ ...statRowStyle, color: 'var(--accent)' }}>
                                    <span>ΔH:</span> <span>{Math.abs(p1 - p2).toFixed(1)} {isLog ? 'dB' : ''}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {fftResult && (
                        <div style={{ ...sidebarSectionStyle, marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                            <div style={statRowStyle}>
                                <span>Max:</span>
                                <span>{fftResult.maxPower.toFixed(1)} {fftSettings.scale === 'log' ? 'dB' : ''}</span>
                            </div>
                            <div style={statRowStyle}>
                                <span>Min:</span>
                                <span>{fftResult.minPower.toFixed(1)} {fftSettings.scale === 'log' ? 'dB' : ''}</span>
                            </div>
                        </div>
                    )}
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
    position: 'relative',
}

const sidebarStyle: React.CSSProperties = {
    width: 260,
    background: 'var(--bg2)',
    borderLeft: '1px solid var(--border)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto'
}

const sidebarSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
}

const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
}

const selectStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '6px 8px',
    borderRadius: 4,
    outline: 'none'
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
    fontSize: 12
}

const checkboxLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    cursor: 'pointer'
}

const btnGroupStyle: React.CSSProperties = {
    display: 'flex',
    gap: 4
}

const toggleBtnStyle: React.CSSProperties = {
    flex: 1,
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '6px 0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500
}

const statRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-muted)'
}

const measBlockStyle: React.CSSProperties = {
    background: 'var(--bg3)',
    padding: 8,
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 4
}
