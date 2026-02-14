import { useCallback } from 'react'
import { useStore } from '../state/store'
import type { SampleFormat } from '../../shared/sample-formats'

export function useCorrelation() {
  const setCorrelationData = useStore((s) => s.setCorrelationData)
  const setCorrelationLoading = useStore((s) => s.setCorrelationLoading)
  const correlationData = useStore((s) => s.correlationData)
  const correlationLoading = useStore((s) => s.correlationLoading)

  const correlate = useCallback(async (
    templateStart: number,
    templateLength: number,
    secondFilePath: string,
    format?: SampleFormat
  ) => {
    try {
      setCorrelationLoading(true)
      const result = await window.snailAPI.correlate({
        templateStart,
        templateLength,
        secondFilePath,
        secondFileFormat: format
      })
      setCorrelationData(result)
    } catch (err) {
      console.error('Correlation failed:', err)
      throw err
    } finally {
      setCorrelationLoading(false)
    }
  }, [setCorrelationData, setCorrelationLoading])

  const clearCorrelation = useCallback(() => {
    setCorrelationData(null)
  }, [setCorrelationData])

  return { correlate, clearCorrelation, correlationData, correlationLoading }
}
