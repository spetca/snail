import { create } from 'zustand'
import type { FileInfo, SampleFormat } from '../../shared/sample-formats'

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

  // Correlation
  correlationData: Float32Array | null
  correlationLoading: boolean

  // Correlation pane
  correlationPaneVisible: boolean
  correlationStartSample: number
  correlationLag: number

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
  setCorrelationData: (data: Float32Array | null) => void
  setCorrelationLoading: (loading: boolean) => void
  setCorrelationPaneVisible: (visible: boolean) => void
  setCorrelationStartSample: (sample: number) => void
  setCorrelationLag: (lag: number) => void
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
  correlationData: null,
  correlationLoading: false,
  correlationPaneVisible: false,
  correlationStartSample: 0,
  correlationLag: 0
}

export const useStore = create<AppState>((set) => ({
  ...initialState,

  setFileInfo: (info) => set({
    fileInfo: info,
    sampleRate: info?.sampleRate ?? 1000000,
    error: null
  }),
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
  setCorrelationData: (correlationData) => set({ correlationData }),
  setCorrelationLoading: (correlationLoading) => set({ correlationLoading }),
  setCorrelationPaneVisible: (correlationPaneVisible) => set({ correlationPaneVisible }),
  setCorrelationStartSample: (correlationStartSample) => set({ correlationStartSample }),
  setCorrelationLag: (correlationLag) => set({ correlationLag }),
  reset: () => set(initialState)
}))
