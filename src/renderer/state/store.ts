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

  // Y-axis zoom
  yZoomLevel: number
  yScrollOffset: number

  // Cursors
  cursors: CursorState

  // Annotations
  annotations: SigMFAnnotation[]

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
  setYZoomLevel: (zoom: number) => void
  setYScrollOffset: (offset: number) => void
  setCursorsEnabled: (enabled: boolean) => void
  setCursorX: (x1: number, x2: number) => void
  setCursorY: (y1: number, y2: number) => void
  setAnnotations: (annotations: SigMFAnnotation[]) => void
  addAnnotation: (annotation: SigMFAnnotation) => void
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
  yZoomLevel: 1,
  yScrollOffset: 0,
  cursors: { enabled: false, x1: 0, x2: 0, y1: 0, y2: 0 },
  annotations: [] as SigMFAnnotation[],
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
  setYZoomLevel: (yZoomLevel) => set({ yZoomLevel }),
  setYScrollOffset: (yScrollOffset) => set({ yScrollOffset }),
  setCursorsEnabled: (enabled) => set((s) => ({
    cursors: { ...s.cursors, enabled }
  })),
  setCursorX: (x1, x2) => set((s) => ({
    cursors: { ...s.cursors, x1, x2 }
  })),
  setCursorY: (y1, y2) => set((s) => ({
    cursors: { ...s.cursors, y1, y2 }
  })),
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) => set((s) => ({
    annotations: [...s.annotations, annotation]
  })),
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
