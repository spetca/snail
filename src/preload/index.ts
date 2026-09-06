import type { DatasetRequest, DatasetJob } from '../shared/dataset'
import type { DetectionState, StartDetectionRequest, ReviewProposalRequest, ReviewProposalResult } from '../shared/detection'
import type { AnnotationFrequencyMode } from '../shared/sigmf'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, SigMFAnnotation, FileInfo, FFTTileRequest, ExportConfig, CorrelateRequest, FFTConfigRequest, FFTResult, ClassificationResult, ProbeResult, PulseRecord, PulseFindRequest, AnalysisSelection } from '../shared/sample-formats'

export interface SnailAPI {
  exportDataset: (request: DatasetRequest) => Promise<DatasetJob | null>
  getDatasetState: (recordingId: string) => Promise<DatasetJob | null>
  cancelDataset: (recordingId: string, jobId: string) => Promise<void>
  getDetectionState: (recordingId: string, knownRevision?: number) => Promise<DetectionState>
  startDetection: (request: StartDetectionRequest) => Promise<DetectionState>
  cancelDetection: (recordingId: string, runId: string) => Promise<void>
  resetDetection: (recordingId: string, expectedRevision: number) => Promise<DetectionState>
  reviewProposal: (request: ReviewProposalRequest) => Promise<ReviewProposalResult>
  probeFile: (path: string) => Promise<ProbeResult>
  openFile: (path: string, format?: SampleFormat, opts?: { viewStart?: number; viewLength?: number }) => Promise<FileInfo>
  getSamples: (start: number, length: number, stride: number | undefined, recordingId: string) => Promise<Float32Array>
  computeFFTTile: (req: FFTTileRequest) => Promise<Float32Array>
  exportSigMF: (config: ExportConfig) => Promise<{ success: boolean; error?: string }>
  correlate: (req: CorrelateRequest) => Promise<Float32Array>
  readFileSamples: (path: string, format: string, start: number, length: number) => Promise<Float32Array>
  saveAnnotation: (filePath: string, annotation: SigMFAnnotation, recordingId: string, mode: AnnotationFrequencyMode, sampleRate: number) => Promise<{ success: boolean; sigmfMetaJson: string }>
  showOpenDialog: () => Promise<string | null>
  showSaveDialog: (defaultName?: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  computeFFT: (req: FFTConfigRequest) => Promise<FFTResult>
  openFFTWindow: () => void
  onFFTUpdate: (callback: (data: AnalysisSelection | null) => void) => () => void
  sendFFTUpdate: (data: AnalysisSelection | null) => void
  openConstellationWindow: () => void
  onConstellationUpdate: (callback: (data: AnalysisSelection | null) => void) => () => void
  sendConstellationUpdate: (data: AnalysisSelection | null) => void
  extractFeatures: (req: { recordingId: string; startSample: number; sampleCount: number; frameSize?: number }) => Promise<{ features: Float32Array; frameCount: number }>
  exportFeatures: (data: { recordingId: string; features: Float32Array; labels: string[]; frameSize: number; appendToPath?: string }) => Promise<{ success: boolean; canceled?: boolean; path?: string; appended?: boolean; totalFrames?: number; classBreakdown?: Record<string, number> }>
  loadClassifier: (modelPath: string) => Promise<{ success: boolean; labels?: string[]; error?: string }>
  classifyRegion: (req: { recordingId: string; startSample: number; sampleCount: number; frameSize?: number }) => Promise<ClassificationResult[]>
  showOpenJsonDialog: () => Promise<string | null>
  trainClassifier: (featuresPath: string) => Promise<{ success: boolean; modelPath?: string; error?: string }>
  findPulses: (req: PulseFindRequest) => Promise<PulseRecord[]>
}

const api: SnailAPI = {
  exportDataset: request => ipcRenderer.invoke(IPC.EXPORT_DATASET, request),
  getDatasetState: recordingId => ipcRenderer.invoke(IPC.DATASET_STATE, recordingId),
  cancelDataset: (recordingId, jobId) => ipcRenderer.invoke(IPC.CANCEL_DATASET, recordingId, jobId),
  getDetectionState: (recordingId, knownRevision) => ipcRenderer.invoke(IPC.DETECTION_STATE, recordingId, knownRevision),
  startDetection: request => ipcRenderer.invoke(IPC.START_DETECTION, request),
  cancelDetection: (recordingId, runId) => ipcRenderer.invoke(IPC.CANCEL_DETECTION, recordingId, runId),
  resetDetection: (recordingId, expectedRevision) => ipcRenderer.invoke(IPC.RESET_DETECTION, recordingId, expectedRevision),
  reviewProposal: request => ipcRenderer.invoke(IPC.REVIEW_PROPOSAL, request),
  probeFile: (path) => ipcRenderer.invoke(IPC.PROBE_FILE, path),
  openFile: (path, format, opts) => ipcRenderer.invoke(IPC.OPEN_FILE, path, format, opts),
  getSamples: (start, length, stride, recordingId) => ipcRenderer.invoke(IPC.GET_SAMPLES, start, length, stride, recordingId),
  computeFFTTile: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT_TILE, req),
  exportSigMF: (config) => ipcRenderer.invoke(IPC.EXPORT_SIGMF, config),
  correlate: (req) => ipcRenderer.invoke(IPC.CORRELATE, req),
  readFileSamples: (path, format, start, length) => ipcRenderer.invoke(IPC.READ_FILE_SAMPLES, path, format, start, length),
  saveAnnotation: (filePath, annotation, recordingId, mode, sampleRate) => ipcRenderer.invoke(IPC.SAVE_ANNOTATION, filePath, annotation, recordingId, mode, sampleRate),
  showOpenDialog: () => ipcRenderer.invoke(IPC.SHOW_OPEN_DIALOG),
  showSaveDialog: (defaultName?) => ipcRenderer.invoke(IPC.SHOW_SAVE_DIALOG, defaultName),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  computeFFT: (req) => ipcRenderer.invoke(IPC.COMPUTE_FFT, req),
  openFFTWindow: () => ipcRenderer.send(IPC.OPEN_FFT_WINDOW),
  onFFTUpdate: (callback: (data: AnalysisSelection | null) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC.FFT_WINDOW_UPDATE, subscription)
    return () => ipcRenderer.removeListener(IPC.FFT_WINDOW_UPDATE, subscription)
  },
  sendFFTUpdate: (data: AnalysisSelection | null) => ipcRenderer.send(IPC.FFT_WINDOW_UPDATE, data),
  openConstellationWindow: () => ipcRenderer.send(IPC.OPEN_CONSTELLATION_WINDOW),
  onConstellationUpdate: (callback: (data: AnalysisSelection | null) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC.CONSTELLATION_WINDOW_UPDATE, subscription)
    return () => ipcRenderer.removeListener(IPC.CONSTELLATION_WINDOW_UPDATE, subscription)
  },
  sendConstellationUpdate: (data: AnalysisSelection | null) => ipcRenderer.send(IPC.CONSTELLATION_WINDOW_UPDATE, data),
  extractFeatures: (req) => ipcRenderer.invoke(IPC.EXTRACT_FEATURES, req),
  exportFeatures: (data) => ipcRenderer.invoke(IPC.EXPORT_FEATURES, data),
  loadClassifier: (modelPath) => ipcRenderer.invoke(IPC.LOAD_CLASSIFIER, modelPath),
  classifyRegion: (req) => ipcRenderer.invoke(IPC.CLASSIFY_REGION, req),
  showOpenJsonDialog: () => ipcRenderer.invoke(IPC.SHOW_OPEN_JSON_DIALOG),
  trainClassifier: (featuresPath) => ipcRenderer.invoke(IPC.TRAIN_CLASSIFIER, featuresPath),
  findPulses: (req) => ipcRenderer.invoke(IPC.FIND_PULSES, req)
}

contextBridge.exposeInMainWorld('snailAPI', api)
