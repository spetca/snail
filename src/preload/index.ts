import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, SigMFAnnotation, FileInfo, FFTTileRequest, ExportConfig, CorrelateRequest, FFTConfigRequest, FFTResult } from '../shared/sample-formats'

export interface SnailAPI {
  openFile: (path: string, format?: SampleFormat) => Promise<FileInfo>
  getSamples: (start: number, length: number, stride?: number) => Promise<Float32Array>
  computeFFTTile: (req: FFTTileRequest) => Promise<Float32Array>
  exportSigMF: (config: ExportConfig) => Promise<{ success: boolean; error?: string }>
  correlate: (req: CorrelateRequest) => Promise<Float32Array>
  readFileSamples: (path: string, format: string, start: number, length: number) => Promise<Float32Array>
  saveAnnotation: (filePath: string, annotation: SigMFAnnotation) => Promise<{ success: boolean }>
  showOpenDialog: () => Promise<string | null>
  showSaveDialog: (defaultName?: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  computeFFT: (req: FFTConfigRequest) => Promise<FFTResult>
  openFFTWindow: () => void
  onFFTUpdate: (callback: (data: any) => void) => () => void
  sendFFTUpdate: (data: any) => void
  openConstellationWindow: () => void
  onConstellationUpdate: (callback: (data: any) => void) => () => void
  sendConstellationUpdate: (data: any) => void
}

const api: SnailAPI = {
  openFile: (path, format) => ipcRenderer.invoke(IPC.OPEN_FILE, path, format),
  getSamples: (start, length, stride) => ipcRenderer.invoke(IPC.GET_SAMPLES, start, length, stride),
  computeFFTTile: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT_TILE, req),
  exportSigMF: (config) => ipcRenderer.invoke(IPC.EXPORT_SIGMF, config),
  correlate: (req) => ipcRenderer.invoke(IPC.CORRELATE, req),
  readFileSamples: (path, format, start, length) => ipcRenderer.invoke(IPC.READ_FILE_SAMPLES, path, format, start, length),
  saveAnnotation: (filePath, annotation) => ipcRenderer.invoke(IPC.SAVE_ANNOTATION, filePath, annotation),
  showOpenDialog: () => ipcRenderer.invoke(IPC.SHOW_OPEN_DIALOG),
  showSaveDialog: (defaultName?) => ipcRenderer.invoke(IPC.SHOW_SAVE_DIALOG, defaultName),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  computeFFT: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT, req),
  openFFTWindow: () => ipcRenderer.send(IPC.OPEN_FFT_WINDOW),
  onFFTUpdate: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC.FFT_WINDOW_UPDATE, subscription)
    return () => ipcRenderer.removeListener(IPC.FFT_WINDOW_UPDATE, subscription)
  },
  sendFFTUpdate: (data: any) => ipcRenderer.send(IPC.FFT_WINDOW_UPDATE, data),
  openConstellationWindow: () => ipcRenderer.send(IPC.OPEN_CONSTELLATION_WINDOW),
  onConstellationUpdate: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC.CONSTELLATION_WINDOW_UPDATE, subscription)
    return () => ipcRenderer.removeListener(IPC.CONSTELLATION_WINDOW_UPDATE, subscription)
  },
  sendConstellationUpdate: (data: any) => ipcRenderer.send(IPC.CONSTELLATION_WINDOW_UPDATE, data)
}

contextBridge.exposeInMainWorld('snailAPI', api)
