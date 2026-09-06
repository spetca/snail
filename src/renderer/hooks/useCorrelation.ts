import { recordingJob } from '../utils/recording'
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
    const job = recordingJob()
    try {
      setCorrelationLoading(true)
      const result = await window.snailAPI.correlate({
        recordingId: job.recordingId,
        mode: 'file',
        windowStart: templateStart,
        windowLength: templateLength,
        patternFilePath: secondFilePath,
        patternFileFormat: format
      })
      if (job.isCurrent()) setCorrelationData(result)
    } catch (err) {
      console.error('Correlation failed:', err)
      throw err
    } finally {
      if (job.isCurrent()) setCorrelationLoading(false)
    }
  }, [setCorrelationData, setCorrelationLoading])

  const clearCorrelation = useCallback(() => {
    setCorrelationData(null)
  }, [setCorrelationData])

  return { correlate, clearCorrelation, correlationData, correlationLoading }
}
