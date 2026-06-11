import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'

export function usePlayback(): void {
  const isPlaying = useStore((s) => s.isPlaying)
  const fileInfo = useStore((s) => s.fileInfo)
  const setPlayheadSample = useStore((s) => s.setPlayheadSample)
  const setIsPlaying = useStore((s) => s.setIsPlaying)

  // Keep a mutable snapshot of all values needed in the RAF loop
  // so the loop closure doesn't go stale without needing restart
  const stateRef = useRef({
    sampleRate: 1000000,
    scrollOffset: 0,
    stride: 512,
    viewWidth: 1000,
    playbackSpeed: 1,
  })

  const sampleRate = useStore((s) => s.sampleRate)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const viewWidth = useStore((s) => s.viewWidth)
  const playbackSpeed = useStore((s) => s.playbackSpeed)

  useEffect(() => {
    stateRef.current = {
      sampleRate,
      scrollOffset,
      stride: Math.max(1, Math.round(fftSize / zoomLevel)),
      viewWidth,
      playbackSpeed,
    }
  })

  const rafRef = useRef<number>()
  const lastTimestampRef = useRef<number | null>(null)
  const playheadRef = useRef<number>(0)

  useEffect(() => {
    if (!isPlaying || !fileInfo) {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      lastTimestampRef.current = null
      if (!fileInfo) setIsPlaying(false)
      return
    }

    // Jump to start of current view
    playheadRef.current = stateRef.current.scrollOffset
    setPlayheadSample(playheadRef.current)

    const tick = (timestamp: number) => {
      if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp
      const elapsed = Math.min(timestamp - lastTimestampRef.current, 100) // cap at 100ms to avoid jump on tab switch
      lastTimestampRef.current = timestamp

      const { sampleRate, scrollOffset, stride, viewWidth, playbackSpeed } = stateRef.current
      const viewEnd = scrollOffset + viewWidth * stride
      const advance = Math.round((sampleRate * playbackSpeed / 1000) * elapsed)

      playheadRef.current += advance
      if (playheadRef.current >= viewEnd || playheadRef.current < scrollOffset) {
        playheadRef.current = scrollOffset
      }

      setPlayheadSample(playheadRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    lastTimestampRef.current = null
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, fileInfo])
}
