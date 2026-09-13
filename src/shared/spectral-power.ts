/** The detector's noise estimate, in the native Hann FFT bin-power scale. */
export function spectralNoiseDb(row: Float32Array, first = 0, last = row.length - 1): number {
  const median = (values: Float32Array) => {
    values.sort()
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
  }
  const full = median(Float32Array.from(row))
  return first === 0 && last === row.length - 1 ? full
    : Math.min(full, median(row.slice(first, last + 1)))
}
