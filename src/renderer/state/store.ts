import type { EventProject, DetectionRun, DetectionState, EventProposal } from '../../shared/detection'
import { readAnnotations, type AnnotationFrequencyMode } from '../../shared/sigmf'
import { pixelToSample, pixelToFrequency, selectionToPixels, type SignalSelection } from '../utils/selection'
import { create } from 'zustand'
import type { FileInfo, SigMFAnnotation, SampleFormat, FFTResult, ClassificationResult } from '../../shared/sample-formats'

export type XAxisMode = 'samples' | 'time'

export interface CursorState {
  enabled: boolean
  x1: number
  x2: number
  y1: number
  y2: number
}

export interface AppState {
  // File
  fileInfo: FileInfo | null
  loading: boolean
  error: string | null

  // Spectrogram
  fftSize: number
  zoomLevel: number
  powerMin: number
  powerMax: number
  scrollOffset: number
  xAxisMode: XAxisMode
  sampleRate: number
  viewWidth: number
  viewHeight: number

  // Y-axis zoom
  yZoomLevel: number
  yScrollOffset: number

  // Physical selection is authoritative; cursors are its derived viewport pixels.
  selection: SignalSelection | null
  cursors: CursorState

  // Machine proposals remain separate from saved annotations.
  eventProject: EventProject | null
  detectionProgress: DetectionRun | null
  detectionError: string | null
  showDetectionPanel: boolean
  selectedProposalId: string | null
  applyDetectionState: (state: DetectionState) => void
  setDetectionError: (error: string | null) => void
  setShowDetectionPanel: (show: boolean) => void
  focusProposal: (proposal: EventProposal) => void

  // Annotations
  annotationFrequencyMode: AnnotationFrequencyMode
  annotations: SigMFAnnotation[]
  annotationsVisible: boolean
  selectedAnnotationIndex: number | null

  // Dialogs
  showExportDialog: boolean
  showAnnotationDialog: boolean
  pendingExport: { start: number; end: number; label?: string; comment?: string } | null

  // Correlation
  correlationEnabled: boolean
  correlationMode: 'file' | 'self'
  correlationFilePath: string | null
  correlationFileFormat: SampleFormat
  correlationData: Float32Array | null
  correlationLoading: boolean
  tu: number
  cpLen: number

  // Classifier
  classificationResults: ClassificationResult[]
  classifierLoaded: boolean
  classifierLabels: string[]

  // Frequency display
  showAbsoluteFrequency: boolean

  // Playback
  isPlaying: boolean
  playheadSample: number
  playbackSpeed: number
  showRealtimeSpectrum: boolean
  realtimeSpectrumMode: 'instant' | 'average' | 'max'

  // FFT Window
  showFFTWindow: boolean
  fftSettings: {
    fftSize: number
    window: 'none' | 'hann' | 'hamming' | 'blackman'
    shift: boolean
    scale: 'abs' | 'log'
    fs: number | null
  }
  fftResult: FFTResult | null
  fftCursors: {
    enabled: boolean
    v1: number // normalized 0-1
    v2: number
    h1: number // normalized 0-1
    h2: number
  }

  // Actions
  setFileInfo: (info: FileInfo | null, initialScroll?: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setFFTSize: (size: number) => void
  setZoomLevel: (zoom: number) => void
  setPowerMin: (min: number) => void
  setPowerMax: (max: number) => void
  setScrollOffset: (offset: number) => void
  setXAxisMode: (mode: XAxisMode) => void
  setSampleRate: (rate: number) => void
  setViewWidth: (width: number) => void
  setViewHeight: (height: number) => void
  setYZoomLevel: (zoom: number) => void
  setYScrollOffset: (offset: number) => void
  setCursorsEnabled: (enabled: boolean) => void
  setCursorX: (x1: number, x2: number) => void
  setCursorY: (y1: number, y2: number) => void
  setAnnotationFrequencyMode: (mode: AnnotationFrequencyMode) => void
  setSigmfMetadata: (json: string) => void
  setAnnotations: (annotations: SigMFAnnotation[]) => void
  setAnnotationsVisible: (visible: boolean) => void
  setSelectedAnnotationIndex: (index: number | null) => void
  addAnnotation: (annotation: SigMFAnnotation) => void
  setShowExportDialog: (show: boolean) => void
  setShowAnnotationDialog: (show: boolean) => void
  setPendingExport: (pending: { start: number; end: number; label?: string; comment?: string } | null) => void
  setCorrelationEnabled: (enabled: boolean) => void
  setCorrelationMode: (mode: 'file' | 'self') => void
  setCorrelationFilePath: (path: string | null) => void
  setCorrelationFileFormat: (format: SampleFormat) => void
  setCorrelationData: (data: Float32Array | null) => void
  setCorrelationLoading: (loading: boolean) => void
  setTu: (tu: number) => void
  setCpLen: (cpLen: number) => void
  setClassificationResults: (results: ClassificationResult[]) => void
  setClassifierLoaded: (loaded: boolean) => void
  setClassifierLabels: (labels: string[]) => void
  setShowAbsoluteFrequency: (v: boolean) => void

  setIsPlaying: (v: boolean) => void
  setPlayheadSample: (v: number) => void
  setPlaybackSpeed: (v: number) => void
  setShowRealtimeSpectrum: (v: boolean) => void
  setRealtimeSpectrumMode: (v: 'instant' | 'average' | 'max') => void

  setShowFFTWindow: (show: boolean) => void
  setFFTSettings: (settings: Partial<AppState['fftSettings']>) => void
  setFFTResult: (result: FFTResult | null) => void
  setFFTCursorsEnabled: (enabled: boolean) => void
  setFFTCursorV: (v1: number, v2: number) => void
  setFFTCursorH: (h1: number, h2: number) => void
  snapToView: () => void
  reset: () => void
}

const initialState = {
  fileInfo: null,
  loading: false,
  error: null,
  fftSize: 512,
  zoomLevel: 1,
  powerMin: -100,
  powerMax: 0,
  scrollOffset: 0,
  xAxisMode: 'samples' as XAxisMode,
  sampleRate: 1000000,
  viewWidth: 1000,
  viewHeight: 600,
  yZoomLevel: 1,
  yScrollOffset: 0,
  selection: null as SignalSelection | null,
  cursors: { enabled: false, x1: 0, x2: 0, y1: 0, y2: 0 },
  eventProject: null as EventProject | null,
  detectionProgress: null as DetectionRun | null,
  detectionError: null as string | null,
  showDetectionPanel: false,
  selectedProposalId: null as string | null,
  annotationFrequencyMode: 'rf' as AnnotationFrequencyMode,
  annotations: [] as SigMFAnnotation[],
  annotationsVisible: true,
  selectedAnnotationIndex: null as number | null,
  showExportDialog: false,
  showAnnotationDialog: false,
  pendingExport: null as { start: number; end: number; label?: string; comment?: string } | null,
  correlationEnabled: false,
  correlationMode: 'file' as 'file' | 'self',
  correlationFilePath: null as string | null,
  correlationFileFormat: 'cf32' as SampleFormat,
  correlationData: null as Float32Array | null,
  correlationLoading: false,
  tu: 1024,
  cpLen: 256,
  classificationResults: [] as ClassificationResult[],
  classifierLoaded: false,
  classifierLabels: [] as string[],
  showAbsoluteFrequency: false,
  isPlaying: false,
  playheadSample: 0,
  playbackSpeed: 1,
  showRealtimeSpectrum: false,
  realtimeSpectrumMode: 'instant' as const,
  showFFTWindow: false,
  fftSettings: {
    fftSize: 2048,
    window: 'hann' as const,
    shift: true,
    scale: 'log' as const,
    fs: null as number | null
  },
  fftResult: null as FFTResult | null,
  fftCursors: {
    enabled: false,
    v1: 0.25,
    v2: 0.75,
    h1: 0.25,
    h2: 0.75
  }
}

function withViewport(state: AppState, patch: Partial<AppState>): Partial<AppState> {
  const next = { ...state, ...patch }
  return next.selection
    ? { ...patch, cursors: { ...next.cursors, ...selectionToPixels(next.selection, next) } }
    : patch
}

function selectionFromPixels(state: AppState): SignalSelection {
  const clamp = (sample: number) => Math.max(0, Math.min(state.fileInfo?.totalSamples ?? Infinity, sample))
  return {
    sample1: clamp(pixelToSample(state.cursors.x1, state)),
    sample2: clamp(pixelToSample(state.cursors.x2, state)),
    frequency1: pixelToFrequency(state.cursors.y1, state),
    frequency2: pixelToFrequency(state.cursors.y2, state)
  }
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  setFileInfo: (info, initialScroll) => {
    let annotations: SigMFAnnotation[] = []
    let metadataError: string | null = null
    try { if (info) annotations = readAnnotations(info) }
    catch (error) { metadataError = `Cannot read annotations: ${String(error)}` }
    set({
      fileInfo: info,
      sampleRate: info?.sampleRate ?? 1000000,
      annotations,
      eventProject: null,
      detectionProgress: null,
      detectionError: null,
      selectedProposalId: null,
      annotationFrequencyMode: 'rf',
      selection: null,
      cursors: { ...initialState.cursors },
      selectedAnnotationIndex: null,
      classificationResults: [],
      correlationData: null,
      correlationEnabled: false,
      correlationFilePath: null,
      correlationLoading: false,
      pendingExport: null,
      showExportDialog: false,
      showAnnotationDialog: false,
      fftResult: null,
      showFFTWindow: false,
      fftCursors: { ...initialState.fftCursors },
      isPlaying: false,
      playheadSample: initialScroll ?? 0,
      error: metadataError,
      zoomLevel: 1,
      scrollOffset: initialScroll ?? 0,
      yZoomLevel: 1,
      yScrollOffset: 0
    })
  },
  applyDetectionState: (response) => set((s) => {
    if (s.fileInfo?.recordingId !== response.recordingId) return {}
    if (response.project && s.eventProject && response.project.sourceKey === s.eventProject.sourceKey && response.project.revision < s.eventProject.revision) return {}
    if (!response.project && s.detectionProgress) {
      if (!response.progress || response.progress.id !== s.detectionProgress.id) return {}
      if (s.detectionProgress.status !== 'running' && response.progress.status === 'running') return {}
    }
    return { ...(response.project ? { eventProject: response.project } : {}), detectionProgress: response.progress, detectionError: null }
  }),
  setDetectionError: (detectionError) => set({ detectionError }),
  setShowDetectionPanel: (showDetectionPanel) => set({ showDetectionPanel }),
  focusProposal: (proposal) => set((s) => {
    if (!s.fileInfo) return {}
    const zoomLevel = Math.min(s.fftSize, s.fftSize * s.viewWidth * 0.7 / Math.max(1, proposal.sampleCount))
    const stride = Math.max(1, Math.round(s.fftSize / zoomLevel))
    const scrollOffset = Math.max(0, Math.min(Math.max(0, s.fileInfo.totalSamples - s.viewWidth * stride),
      Math.round(proposal.sampleStart + proposal.sampleCount / 2 - s.viewWidth * stride / 2)))
    const selection = { sample1: proposal.sampleStart, sample2: proposal.sampleStart + proposal.sampleCount,
      frequency1: proposal.freqUpperEdge, frequency2: proposal.freqLowerEdge }
    return withViewport(s, { selectedProposalId: proposal.id, selectedAnnotationIndex: null, selection,
      cursors: { ...s.cursors, enabled: true }, zoomLevel, scrollOffset, yZoomLevel: 1, yScrollOffset: 0 })
  }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFFTSize: (fftSize) => {
    const s = get()
    // stride = currentFFTSize / currentZoom
    // newZoom = newFFTSize / stride
    const currentStride = Math.max(1, Math.round(s.fftSize / s.zoomLevel))
    const nextZoom = fftSize / currentStride
    const yZoomLevel = Math.min(s.yZoomLevel, fftSize / 2)
    const yScrollOffset = Math.min(s.yScrollOffset, fftSize / 2 * (1 - 1 / yZoomLevel))
    set(withViewport(s, { fftSize, zoomLevel: nextZoom, yZoomLevel, yScrollOffset }))
  },
  setZoomLevel: (zoomLevel) => set((s) => withViewport(s, { zoomLevel })),
  setPowerMin: (powerMin) => set({ powerMin }),
  setPowerMax: (powerMax) => set({ powerMax }),
  setScrollOffset: (scrollOffset) => set((s) => withViewport(s, { scrollOffset })),
  setXAxisMode: (xAxisMode) => set({ xAxisMode }),
  setSampleRate: (sampleRate) => set((s) => withViewport(s, { sampleRate })),
  setViewWidth: (viewWidth) => set((s) => withViewport(s, { viewWidth })),
  setViewHeight: (viewHeight) => set((s) => withViewport(s, { viewHeight })),
  setYZoomLevel: (yZoomLevel) => set((s) => withViewport(s, { yZoomLevel })),
  setYScrollOffset: (yScrollOffset) => set((s) => withViewport(s, { yScrollOffset })),
  setCursorsEnabled: (enabled) => set((s) => {
    let selection = s.selection
    if (enabled && !selection) {
      selection = selectionFromPixels({ ...s, cursors: {
        enabled, x1: s.viewWidth * 0.25, x2: s.viewWidth * 0.75,
        y1: s.viewHeight * 0.25, y2: s.viewHeight * 0.75
      } })
    }
    return withViewport(s, { selection, cursors: { ...s.cursors, enabled } })
  }),
  setCursorX: (x1, x2) => set((s) => {
    const fromPixels = selectionFromPixels({ ...s, cursors: { ...s.cursors, x1, x2 } })
    const selection = { ...(s.selection ?? fromPixels), sample1: fromPixels.sample1, sample2: fromPixels.sample2 }
    return withViewport(s, { selection })
  }),
  setCursorY: (y1, y2) => set((s) => {
    const fromPixels = selectionFromPixels({ ...s, cursors: { ...s.cursors, y1, y2 } })
    const selection = { ...(s.selection ?? fromPixels), frequency1: fromPixels.frequency1, frequency2: fromPixels.frequency2 }
    return withViewport(s, { selection })
  }),
  setAnnotationFrequencyMode: (annotationFrequencyMode) => set({ annotationFrequencyMode }),
  setSigmfMetadata: (json) => set((s) => {
    if (!s.fileInfo) return {}
    const fileInfo = { ...s.fileInfo, sigmfMetaJson: json }
    return { fileInfo, annotations: readAnnotations(fileInfo), annotationFrequencyMode: 'rf' }
  }),
  setAnnotations: (annotations) => set({ annotations }),
  setAnnotationsVisible: (visible) => set({ annotationsVisible: visible }),
  setSelectedAnnotationIndex: (index) => set({ selectedAnnotationIndex: index }),
  addAnnotation: (annotation) => set((s) => ({
    annotations: [...s.annotations, annotation]
  })),
  setShowExportDialog: (showExportDialog) => set({ showExportDialog }),
  setShowAnnotationDialog: (showAnnotationDialog) => set({ showAnnotationDialog }),
  setPendingExport: (pendingExport) => set({ pendingExport }),
  setCorrelationEnabled: (correlationEnabled) => set((s) => ({
    correlationEnabled,
    // Clear data when toggling off
    ...(correlationEnabled ? {} : {
      correlationData: null,
      correlationFilePath: null
    })
  })),
  setCorrelationMode: (correlationMode) => set({ correlationMode, correlationData: null }),
  setCorrelationFilePath: (correlationFilePath) => set({
    correlationFilePath,
    correlationData: null
  }),
  setCorrelationFileFormat: (correlationFileFormat) => set({ correlationFileFormat }),
  setCorrelationData: (correlationData) => set({ correlationData }),
  setCorrelationLoading: (correlationLoading) => set({ correlationLoading }),
  setTu: (tu) => set({ tu, correlationData: null }),
  setCpLen: (cpLen) => set({ cpLen, correlationData: null }),
  setClassificationResults: (classificationResults) => set({ classificationResults }),
  setClassifierLoaded: (classifierLoaded) => set({ classifierLoaded }),
  setClassifierLabels: (classifierLabels) => set({ classifierLabels }),
  setShowAbsoluteFrequency: (showAbsoluteFrequency) => set({ showAbsoluteFrequency }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlayheadSample: (playheadSample) => set({ playheadSample }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setShowRealtimeSpectrum: (showRealtimeSpectrum) => set({ showRealtimeSpectrum }),
  setRealtimeSpectrumMode: (realtimeSpectrumMode) => set({ realtimeSpectrumMode }),

  setShowFFTWindow: (show) => set({ showFFTWindow: show }),
  setFFTSettings: (settings) => set((s) => ({
    fftSettings: { ...s.fftSettings, ...settings }
  })),
  setFFTResult: (result) => set({ fftResult: result }),
  setFFTCursorsEnabled: (enabled) => set((s) => ({
    fftCursors: { ...s.fftCursors, enabled }
  })),
  setFFTCursorV: (v1, v2) => set((s) => ({
    fftCursors: { ...s.fftCursors, v1, v2 }
  })),
  setFFTCursorH: (h1, h2) => set((s) => ({
    fftCursors: { ...s.fftCursors, h1, h2 }
  })),
  snapToView: () => {
    const s = get()
    if (!s.fileInfo) return
    const vw = s.viewWidth > 0 ? s.viewWidth : 1000
    const fillZoom = (s.fftSize * vw) / s.fileInfo.totalSamples
    set(withViewport(s, {
      zoomLevel: Math.min(s.fftSize, fillZoom),
      scrollOffset: 0,
      yZoomLevel: 1,
      yScrollOffset: 0
    }))
  },
  reset: () => set(initialState)
}))
