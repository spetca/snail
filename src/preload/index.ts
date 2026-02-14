import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, SigMFAnnotation, FileInfo, FFTTileRequest, ExportConfig, CorrelateRequest } from '../shared/sample-formats'

export interface SnailAPI {
  openFile: (path: string, format?: SampleFormat) => Promise<FileInfo>
  getSamples: (start: number, length: number) => Promise<Float32Array>
  computeFFTTile: (req: FFTTileRequest) => Promise<Float32Array>
  exportSigMF: (config: ExportConfig) => Promise<{ success: boolean; error?: string }>
  correlate: (req: CorrelateRequest) => Promise<Float32Array>
  readFileSamples: (path: string, format: string, start: number, length: number) => Promise<Float32Array>
  saveAnnotation: (filePath: string, annotation: SigMFAnnotation) => Promise<{ success: boolean }>
  showOpenDialog: () => Promise<string | null>
  showSaveDialog: (defaultName?: string) => Promise<string | null>
  getPathForFile: (file: File) => string
}

const api: SnailAPI = {
  openFile: (path, format) => ipcRenderer.invoke(IPC.OPEN_FILE, path, format),
  getSamples: (start, length) => ipcRenderer.invoke(IPC.GET_SAMPLES, start, length),
  computeFFTTile: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT_TILE, req),
  exportSigMF: (config) => ipcRenderer.invoke(IPC.EXPORT_SIGMF, config),
  correlate: (req) => ipcRenderer.invoke(IPC.CORRELATE, req),
  readFileSamples: (path, format, start, length) => ipcRenderer.invoke(IPC.READ_FILE_SAMPLES, path, format, start, length),
  saveAnnotation: (filePath, annotation) => ipcRenderer.invoke(IPC.SAVE_ANNOTATION, filePath, annotation),
  showOpenDialog: () => ipcRenderer.invoke(IPC.SHOW_OPEN_DIALOG),
  showSaveDialog: (defaultName?) => ipcRenderer.invoke(IPC.SHOW_SAVE_DIALOG, defaultName),
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('snailAPI', api)
