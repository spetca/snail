/** Median via quickselect; fallback bounds adversarial partitioning to O(n log n). */
function median(values: Float32Array): number {
  const target = Math.floor(values.length / 2)
  let low = 0, high = values.length - 1, budget = 2 * Math.ceil(Math.log2(values.length + 1))
  while (low < high && budget-- > 0) {
    const pivot = values[(low + high) >>> 1]
    let i = low, j = high
    while (i <= j) {
      while (values[i] < pivot) ++i
      while (values[j] > pivot) --j
      if (i <= j) { const value = values[i]; values[i++] = values[j]; values[j--] = value }
    }
    if (target <= j) high = j
    else if (target >= i) low = i
    else break
  }
  if (budget < 0) values.sort()
  const upper = values[target]
  if (values.length % 2) return upper
  let lower = -Infinity
  for (let i = 0; i < target; ++i) lower = Math.max(lower, values[i])
  return (lower + upper) / 2
}

/** The detector's noise estimate, in the native Hann FFT bin-power scale. */
export function spectralNoiseDb(row: Float32Array, first = 0, last = row.length - 1): number {
  const full = median(Float32Array.from(row))
  return first === 0 && last === row.length - 1 ? full
    : Math.min(full, median(row.slice(first, last + 1)))
}
