import { create } from 'zustand'
import type { FileInfo, SigMFAnnotation, SampleFormat, FFTResult } from '../../shared/sample-formats'

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

  // Cursors
  cursors: CursorState

  // Annotations
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
  setFileInfo: (info: FileInfo | null) => void
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
  cursors: { enabled: false, x1: 0, x2: 0, y1: 0, y2: 0 },
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

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  setFileInfo: (info) => {
    let annotations: SigMFAnnotation[] = []
    if (info?.sigmfMetaJson) {
      try {
        const meta = JSON.parse(info.sigmfMetaJson)
        if (Array.isArray(meta.annotations)) {
          annotations = meta.annotations.map((a: any) => ({
            sampleStart: a['core:sample_start'] ?? 0,
            sampleCount: a['core:sample_count'] ?? 0,
            freqLowerEdge: a['core:freq_lower_edge'],
            freqUpperEdge: a['core:freq_upper_edge'],
            label: a['core:label'],
            comment: a['core:comment']
          }))
        }
      } catch { /* ignore parse errors */ }
    }
    set({
      fileInfo: info,
      sampleRate: info?.sampleRate ?? 1000000,
      annotations,
      error: null,
      zoomLevel: 1,
      scrollOffset: 0,
      yZoomLevel: 1,
      yScrollOffset: 0
    })
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFFTSize: (fftSize) => {
    const s = get()
    // stride = currentFFTSize / currentZoom
    // newZoom = newFFTSize / stride
    const currentStride = s.fftSize / s.zoomLevel
    const nextZoom = fftSize / currentStride
    set({ fftSize, zoomLevel: nextZoom })
  },
  setZoomLevel: (zoomLevel) => set({ zoomLevel }),
  setPowerMin: (powerMin) => set({ powerMin }),
  setPowerMax: (powerMax) => set({ powerMax }),
  setScrollOffset: (scrollOffset) => set({ scrollOffset }),
  setXAxisMode: (xAxisMode) => set({ xAxisMode }),
  setSampleRate: (sampleRate) => set({ sampleRate }),
  setViewWidth: (viewWidth) => set({ viewWidth }),
  setViewHeight: (viewHeight) => set({ viewHeight }),
  setYZoomLevel: (yZoomLevel) => set({ yZoomLevel }),
  setYScrollOffset: (yScrollOffset) => set({ yScrollOffset }),
  setCursorsEnabled: (enabled) => set((s) => {
    const nextCursors = { ...s.cursors, enabled }
    // If enabling and cursors are at default (0,0,0,0), spread them
    if (enabled && s.cursors.x1 === 0 && s.cursors.x2 === 0) {
      nextCursors.x1 = s.viewWidth * 0.25
      nextCursors.x2 = s.viewWidth * 0.75
      nextCursors.y1 = s.viewHeight * 0.25
      nextCursors.y2 = s.viewHeight * 0.75
    }
    return { cursors: nextCursors }
  }),
  setCursorX: (x1, x2) => set((s) => ({
    cursors: { ...s.cursors, x1, x2 }
  })),
  setCursorY: (y1: number, y2: number) => set((s) => ({
    cursors: { ...s.cursors, y1, y2 }
  })),
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
    set({
      zoomLevel: Math.min(s.fftSize, fillZoom),
      scrollOffset: 0,
      yZoomLevel: 1,
      yScrollOffset: 0
    })
  },
  reset: () => set(initialState)
}))
