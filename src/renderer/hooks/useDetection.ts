import { useEffect } from 'react'
import { useStore } from '../state/store'

/** Restore proposals on open; poll bounded status while a scan is running. */
export function useDetection(): void {
  const recordingId = useStore(s => s.fileInfo?.recordingId)
  useEffect(() => {
    if (!recordingId) return
    let cancelled = false, pending = false
    const refresh = async () => {
      if (pending || cancelled) return
      pending = true
      try {
        const state = useStore.getState()
        const result = await window.snailAPI.getDetectionState(recordingId, state.eventProject?.revision)
        if (!cancelled) useStore.getState().applyDetectionState(result)
      } catch (error) {
        if (!cancelled && useStore.getState().fileInfo?.recordingId === recordingId) {
          useStore.getState().setDetectionError(String(error))
        }
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => {
      if (useStore.getState().detectionProgress?.status === 'running') void refresh()
    }, 400)
    return () => { cancelled = true; clearInterval(timer) }
  }, [recordingId])
}
