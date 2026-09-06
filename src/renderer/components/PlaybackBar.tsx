import React from 'react'
import { useStore } from '../state/store'

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4]

function formatTime(samples: number, sampleRate: number): string {
  const secs = samples / sampleRate
  if (secs < 1) return `${(secs * 1000).toFixed(1)} ms`
  if (secs < 60) return `${secs.toFixed(3)} s`
  const m = Math.floor(secs / 60)
  const s = (secs % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

export function PlaybackBar(): React.ReactElement | null {
  const fileInfo = useStore((s) => s.fileInfo)
  const isPlaying = useStore((s) => s.isPlaying)
  const playheadSample = useStore((s) => s.playheadSample)
  const playbackSpeed = useStore((s) => s.playbackSpeed)
  const sampleRate = useStore((s) => s.sampleRate)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const viewWidth = useStore((s) => s.viewWidth)
  const showRealtimeSpectrum = useStore((s) => s.showRealtimeSpectrum)

  const setIsPlaying = useStore((s) => s.setIsPlaying)
  const setPlayheadSample = useStore((s) => s.setPlayheadSample)
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed)
  const setShowRealtimeSpectrum = useStore((s) => s.setShowRealtimeSpectrum)

  if (!fileInfo) return null

  const stride = Math.max(1, Math.round(fftSize / zoomLevel))
  const viewStartSample = scrollOffset
  const viewEndSample = scrollOffset + viewWidth * stride
  const viewDuration = (viewEndSample - viewStartSample) / sampleRate
  const elapsed = (playheadSample - viewStartSample) / sampleRate

  const handlePlayPause = () => {
    if (!isPlaying) {
      setPlayheadSample(viewStartSample)
      setIsPlaying(true)
    } else {
      setIsPlaying(false)
    }
  }

  const handleStop = () => {
    setIsPlaying(false)
    setPlayheadSample(viewStartSample)
  }

  const btnBase: React.CSSProperties = {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 4,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 4
  }

  const activeBtn: React.CSSProperties = {
    ...btnBase,
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#fff'
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg2)',
      flexShrink: 0,
      fontSize: 13
    }}>
      {/* Transport controls */}
      <button onClick={handleStop} style={btnBase} title="Stop">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect x="1" y="1" width="8" height="8" />
        </svg>
      </button>
      <button onClick={handlePlayPause} style={isPlaying ? activeBtn : btnBase} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
            <rect x="1" y="1" width="3.5" height="10" />
            <rect x="6.5" y="1" width="3.5" height="10" />
          </svg>
        ) : (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
            <polygon points="1,1 10,6 1,11" />
          </svg>
        )}
      </button>

      <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

      {/* Speed */}
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Speed</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setPlaybackSpeed(s)}
            style={{
              ...btnBase,
              padding: '2px 7px',
              fontSize: 11,
              ...(playbackSpeed === s ? { background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' } : {})
            }}
          >
            {s === 1 ? '1×' : s < 1 ? `${s}×` : `${s}×`}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

      {/* Position */}
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 120 }}>
        {formatTime(Math.max(0, elapsed), 1)} / {formatTime(viewDuration, 1)}
      </span>

      <div style={{ flex: 1 }} />

      {/* Spectrum toggle */}
      <button
        onClick={() => setShowRealtimeSpectrum(!showRealtimeSpectrum)}
        style={showRealtimeSpectrum ? activeBtn : btnBase}
        title="Toggle real-time spectrum"
      >
        <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="1,11 4,6 7,3 10,7 13,2" />
        </svg>
        Spectrum
      </button>
    </div>
  )
}
