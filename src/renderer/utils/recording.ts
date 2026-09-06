import { useStore } from '../state/store'
import type { SampleFormat } from '../../shared/sample-formats'

export function recordingJob(recordingId = useStore.getState().fileInfo?.recordingId) {
  const isCurrent = () => !!recordingId && useStore.getState().fileInfo?.recordingId === recordingId
  return {
    recordingId: recordingId ?? '',
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) throw new Error('Recording changed. Run the operation again.')
    }
  }
}

let openGeneration = 0
export async function openRecording(path: string, format?: SampleFormat, initialScroll = 0): Promise<void> {
  const generation = ++openGeneration
  const state = useStore.getState()
  state.setLoading(true)
  state.setError(null)
  try {
    const info = await window.snailAPI.openFile(path, format)
    if (generation === openGeneration) state.setFileInfo(info, initialScroll)
  } catch (error) {
    if (generation === openGeneration) state.setError(error instanceof Error ? error.message : String(error))
  } finally {
    if (generation === openGeneration) state.setLoading(false)
  }
}
