import { useCallback } from 'react'
import { useStore } from '../state/store'
import type { SampleFormat } from '../../shared/sample-formats'

export function useFileLoader() {
  const setFileInfo = useStore((s) => s.setFileInfo)
  const setLoading = useStore((s) => s.setLoading)
  const setError = useStore((s) => s.setError)
  const reset = useStore((s) => s.reset)

  const openFile = useCallback(async (path: string, format?: SampleFormat) => {
    try {
      reset()
      setLoading(true)
      const info = await window.snailAPI.openFile(path, format)
      setFileInfo(info)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [setFileInfo, setLoading, setError, reset])

  const openDialog = useCallback(async () => {
    const path = await window.snailAPI.showOpenDialog()
    if (path) await openFile(path)
  }, [openFile])

  return { openFile, openDialog }
}
