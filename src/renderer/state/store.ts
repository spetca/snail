import { create } from 'zustand'
import type { FileInfo, SigMFAnnotation, SampleFormat } from '../../shared/sample-formats'

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
  selectedAnnotationIndex: number | null

  // Dialogs
  showExportDialog: boolean
  showAnnotationDialog: boolean
  pendingExport: { start: number; end: number; label?: string; comment?: string } | null

  // Correlation
  correlationEnabled: boolean
  correlationFilePath: string | null
  correlationFileFormat: SampleFormat
  correlationData: Float32Array | null
  correlationLoading: boolean

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
  setSelectedAnnotationIndex: (index: number | null) => void
  addAnnotation: (annotation: SigMFAnnotation) => void
  setShowExportDialog: (show: boolean) => void
  setShowAnnotationDialog: (show: boolean) => void
  setPendingExport: (pending: { start: number; end: number; label?: string; comment?: string } | null) => void
  setCorrelationEnabled: (enabled: boolean) => void
  setCorrelationFilePath: (path: string | null) => void
  setCorrelationFileFormat: (format: SampleFormat) => void
  setCorrelationData: (data: Float32Array | null) => void
  setCorrelationLoading: (loading: boolean) => void
  reset: () => void
}

const initialState = {
  fileInfo: null,
  loading: false,
  error: null,
  fftSize: 2048,
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
  selectedAnnotationIndex: null as number | null,
  showExportDialog: false,
  showAnnotationDialog: false,
  pendingExport: null as { start: number; end: number; label?: string; comment?: string } | null,
  correlationEnabled: false,
  correlationFilePath: null as string | null,
  correlationFileFormat: 'cf32' as SampleFormat,
  correlationData: null as Float32Array | null,
  correlationLoading: false
}

export const useStore = create<AppState>((set) => ({
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
      error: null
    })
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFFTSize: (fftSize) => set({ fftSize }),
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
  setCorrelationFilePath: (correlationFilePath) => set({
    correlationFilePath,
    correlationData: null
  }),
  setCorrelationFileFormat: (correlationFileFormat) => set({ correlationFileFormat }),
  setCorrelationData: (correlationData) => set({ correlationData }),
  setCorrelationLoading: (correlationLoading) => set({ correlationLoading }),
  reset: () => set(initialState)
}))
