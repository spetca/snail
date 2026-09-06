import { useStore } from '../state/store'

export function useCursors() {
  const cursors = useStore((s) => s.cursors)
  const selection = useStore((s) => s.selection)
  const sampleRate = useStore((s) => s.sampleRate)
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)

  const scrollOffset = useStore((s) => s.scrollOffset)
  const samplesPerPixel = Math.max(1, Math.round(fftSize / zoomLevel))

  const sampleRange = {
    start: selection ? Math.min(selection.sample1, selection.sample2) : Math.round(scrollOffset + Math.min(cursors.x1, cursors.x2) * samplesPerPixel),
    end: selection ? Math.max(selection.sample1, selection.sample2) : Math.round(scrollOffset + Math.max(cursors.x1, cursors.x2) * samplesPerPixel),
    delta: 0
  }

  sampleRange.delta = sampleRange.end - sampleRange.start

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
