import type { FFTTileRequest } from '../../shared/sample-formats'

const budget = 32 * 1024 * 1024
const cached = new Map<string, Float32Array>()
const pending = new Map<string, Promise<Float32Array>>()
let bytes = 0
let recording = ''

/** Shared exact CPU FFT tiles for fallback display and power measurements. */
export function fftTile(req: FFTTileRequest): Promise<Float32Array> {
  if (recording !== req.recordingId) { recording = req.recordingId; cached.clear(); bytes = 0 }
  const key = `${req.recordingId}:${req.startSample}:${req.fftSize}:${req.stride}`
  const data = cached.get(key)
  if (data) { cached.delete(key); cached.set(key, data); return Promise.resolve(data) }
  const existing = pending.get(key)
  if (existing) return existing
  const promise = window.snailAPI.computeFFTTile(req).then(result => {
    if (recording === req.recordingId && result.byteLength <= budget) {
      while (bytes + result.byteLength > budget && cached.size) {
        const oldest = cached.keys().next().value!
        bytes -= cached.get(oldest)!.byteLength; cached.delete(oldest)
      }
      cached.set(key, result); bytes += result.byteLength
    }
    return result
  }).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}
