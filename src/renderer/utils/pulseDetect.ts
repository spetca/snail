// Scan stride: sample every Nth file sample to cover large files quickly
const SCAN_STRIDE = 512
// Samples fetched per IPC call (covers SCAN_CHUNK * SCAN_STRIDE file samples)
const SCAN_CHUNK = 4096
// Max IPC calls before giving up (~100M file samples at default stride)
const MAX_CHUNKS = 50

function samplePower(buf: Float32Array, i: number): number {
  const I = buf[i * 2]
  const Q = buf[i * 2 + 1]
  return I * I + Q * Q
}

async function fetchSamples(start: number, length: number, stride: number): Promise<Float32Array> {
  const raw = await window.snailAPI.getSamples(start, length, stride)
  if (raw instanceof Float32Array) return raw
  return new Float32Array((raw as any).buffer ?? raw)
}

/**
 * Scan forward/backward for the start of the next/previous pulse.
 *
 * Forward state machine: skip_signal → (quiet) → find_signal → (loud) → FOUND
 * Backward state machine: skip_signal → (quiet) → find_end → (loud) → find_start → (quiet) → FOUND
 *
 * @param startSample  File sample to begin scanning from
 * @param direction    'forward' | 'backward'
 * @param totalSamples Total file samples (upper bound)
 * @param threshold    Linear power threshold (I²+Q² units)
 * @param cancelRef    Set .current = true to abort the async scan
 * @returns            File sample index of next pulse start, or null if not found
 */
export async function findNextPulse(
  startSample: number,
  direction: 'forward' | 'backward',
  totalSamples: number,
  threshold: number,
  cancelRef: { current: boolean }
): Promise<number | null> {
  const step = SCAN_CHUNK * SCAN_STRIDE

  if (direction === 'forward') {
    let pos = Math.max(0, startSample)
    let state: 'skip_signal' | 'find_signal' = 'skip_signal'

    for (let chunk = 0; chunk < MAX_CHUNKS && pos < totalSamples; chunk++) {
      if (cancelRef.current) return null

      const len = Math.min(SCAN_CHUNK, Math.ceil((totalSamples - pos) / SCAN_STRIDE))
      if (len <= 0) break

      const buf = await fetchSamples(pos, len, SCAN_STRIDE)

      for (let i = 0; i < Math.floor(buf.length / 2); i++) {
        const p = samplePower(buf, i)
        if (state === 'skip_signal' && p < threshold) {
          state = 'find_signal'
        } else if (state === 'find_signal' && p >= threshold) {
          return pos + i * SCAN_STRIDE
        }
      }

      pos += len * SCAN_STRIDE
    }
  } else {
    // Backward: find start of the previous pulse
    // States: skip_signal (if in one) → find_end (scan until signal found) → find_start (scan until signal starts)
    let pos = Math.min(totalSamples - 1, startSample)
    let state: 'skip_signal' | 'find_end' | 'find_start' = 'skip_signal'

    for (let chunk = 0; chunk < MAX_CHUNKS && pos > 0; chunk++) {
      if (cancelRef.current) return null

      const fetchStart = Math.max(0, pos - step)
      const len = Math.min(SCAN_CHUNK, Math.ceil((pos - fetchStart) / SCAN_STRIDE) + 1)
      if (len <= 0) break

      const buf = await fetchSamples(fetchStart, len, SCAN_STRIDE)

      // Scan backward through this chunk
      for (let i = Math.floor(buf.length / 2) - 1; i >= 0; i--) {
        const sPos = fetchStart + i * SCAN_STRIDE
        if (sPos > pos) continue

        const p = samplePower(buf, i)

        if (state === 'skip_signal' && p < threshold) {
          state = 'find_end'
        } else if (state === 'find_end' && p >= threshold) {
          state = 'find_start'
        } else if (state === 'find_start' && p < threshold) {
          return sPos + SCAN_STRIDE
        }
      }

      if (fetchStart === 0) {
        if (state === 'find_start') return 0
        break
      }
      pos = fetchStart
    }
  }

  return null
}
