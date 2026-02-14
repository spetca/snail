import { useCallback } from 'react'
import { useStore } from '../state/store'

export function useSpectrogram() {
  const fftSize = useStore((s) => s.fftSize)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const scrollOffset = useStore((s) => s.scrollOffset)
  const fileInfo = useStore((s) => s.fileInfo)

  const samplesPerColumn = fftSize / zoomLevel

  const sampleToPixel = useCallback((sample: number): number => {
    return (sample - scrollOffset) / samplesPerColumn
  }, [scrollOffset, samplesPerColumn])

  const pixelToSample = useCallback((pixel: number): number => {
    return scrollOffset + pixel * samplesPerColumn
  }, [scrollOffset, samplesPerColumn])

  const pixelToFrequency = useCallback((pixelY: number, plotHeight: number, sampleRate: number): number => {
    // From spectrogramplot.cpp line 195: freq = (0.5 - pixelY/plotHeight) * sampleRate
    return (0.5 - pixelY / plotHeight) * sampleRate
  }, [])

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
