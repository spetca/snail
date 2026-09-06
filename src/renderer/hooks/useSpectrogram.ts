import { useCallback } from 'react'
import { useStore } from '../state/store'

export function useSpectrogram() {
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fileInfo = useStore((s) => s.fileInfo)

  const yZoomLevel = useStore((s) => s.yZoomLevel)
  const yScrollOffset = useStore((s) => s.yScrollOffset)
  const samplesPerColumn = Math.max(1, Math.round(fftSize / zoomLevel))

  const sampleToPixel = useCallback((sample: number): number => {
    return (sample - scrollOffset) / samplesPerColumn
  }, [scrollOffset, samplesPerColumn])

  const pixelToSample = useCallback((pixel: number): number => {
    return scrollOffset + pixel * samplesPerColumn
  }, [scrollOffset, samplesPerColumn])

  const pixelToFrequency = useCallback((pixelY: number, plotHeight: number, sampleRate: number): number => {
    if (plotHeight <= 0) return 0
    return (0.5 - yScrollOffset / (fftSize / 2) - pixelY / plotHeight / yZoomLevel) * sampleRate
  }, [fftSize, yZoomLevel, yScrollOffset])

  return {
    fftSize,
    zoomLevel,
    scrollOffset,
    samplesPerColumn,
    sampleToPixel,
    pixelToSample,
    pixelToFrequency,
    totalSamples: fileInfo?.totalSamples ?? 0
  }
}
