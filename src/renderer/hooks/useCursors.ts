import { useStore } from '../state/store'

export function useCursors() {
  const cursors = useStore((s) => s.cursors)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)

  const samplesPerPixel = fftSize / zoomLevel

  const sampleRange = {
    start: Math.round(Math.min(cursors.x1, cursors.x2) * samplesPerPixel),
    end: Math.round(Math.max(cursors.x1, cursors.x2) * samplesPerPixel),
    delta: Math.round(Math.abs(cursors.x2 - cursors.x1) * samplesPerPixel)
  }

  const timeRange = {
    start: sampleRange.start / sampleRate,
    end: sampleRange.end / sampleRate,
    delta: sampleRange.delta / sampleRate
  }

  return {
    enabled: cursors.enabled,
    sampleRange,
    timeRange
  }
}
