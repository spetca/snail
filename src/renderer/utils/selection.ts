export interface SignalSelection {
  sample1: number
  sample2: number
  frequency1: number // Hz relative to baseband
  frequency2: number
}

export interface Viewport {
  fftSize: number
  zoomLevel: number
  scrollOffset: number
  sampleRate: number
  viewHeight: number
  yZoomLevel: number
  yScrollOffset: number
}

export function sampleStride(view: Viewport): number {
  return Math.max(1, Math.round(view.fftSize / view.zoomLevel))
}

export function pixelToSample(x: number, view: Viewport): number {
  return Math.round(view.scrollOffset + x * sampleStride(view))
}

export function pixelToFrequency(y: number, view: Viewport): number {
  if (view.viewHeight <= 0) return 0
  return (0.5 - view.yScrollOffset / (view.fftSize / 2) - y / view.viewHeight / view.yZoomLevel) * view.sampleRate
}

export function selectionToPixels(selection: SignalSelection, view: Viewport) {
  const stride = sampleStride(view)
  const frequencyToPixel = (hz: number) =>
    (0.5 - hz / view.sampleRate - view.yScrollOffset / (view.fftSize / 2)) * view.yZoomLevel * view.viewHeight
  return {
    x1: (selection.sample1 - view.scrollOffset) / stride,
    x2: (selection.sample2 - view.scrollOffset) / stride,
    y1: frequencyToPixel(selection.frequency1),
    y2: frequencyToPixel(selection.frequency2)
  }
}
