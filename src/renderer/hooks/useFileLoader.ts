import { useCallback } from 'react'
import { openRecording } from '../utils/recording'

export function useFileLoader() {
  const openFile = useCallback(openRecording, [])

  const openDialog = useCallback(async () => {
    const path = await window.snailAPI.showOpenDialog()
    if (path) await openFile(path)
  }, [openFile])

  return { openFile, openDialog }
}
