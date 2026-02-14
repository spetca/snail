import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, FileInfo, FFTTileRequest, ExportConfig, CorrelateRequest } from '../shared/sample-formats'

export interface SnailAPI {
  openFile: (path: string, format?: SampleFormat) => Promise<FileInfo>
  getSamples: (start: number, length: number) => Promise<Float32Array>
  computeFFTTile: (req: FFTTileRequest) => Promise<Float32Array>
  exportSigMF: (config: ExportConfig) => Promise<{ success: boolean; error?: string }>
  correlate: (req: CorrelateRequest) => Promise<Float32Array>
  showOpenDialog: () => Promise<string | null>
  getPathForFile: (file: File) => string
}

const api: SnailAPI = {
  openFile: (path, format) => ipcRenderer.invoke(IPC.OPEN_FILE, path, format),
  getSamples: (start, length) => ipcRenderer.invoke(IPC.GET_SAMPLES, start, length),
  computeFFTTile: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT_TILE, req),
  exportSigMF: (config) => ipcRenderer.invoke(IPC.EXPORT_SIGMF, config),
  correlate: (req) => ipcRenderer.invoke(IPC.CORRELATE, req),
  showOpenDialog: () => ipcRenderer.invoke(IPC.SHOW_OPEN_DIALOG),
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('snailAPI', api)
