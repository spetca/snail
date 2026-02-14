const SI_PREFIXES = [
  { threshold: 1, suffix: 's', divisor: 1 },
  { threshold: 1e-3, suffix: 'ms', divisor: 1e-3 },
  { threshold: 1e-6, suffix: '\u00B5s', divisor: 1e-6 },
  { threshold: 1e-9, suffix: 'ns', divisor: 1e-9 }
]

export function formatTimeValue(seconds: number): string {
  const abs = Math.abs(seconds)
  for (const { threshold, suffix, divisor } of SI_PREFIXES) {
    if (abs >= threshold) {
      return `${(seconds / divisor).toFixed(2)} ${suffix}`
    }
  }
  return `${(seconds / 1e-9).toFixed(2)} ns`
}

export function formatFrequency(hz: number): string {
  const abs = Math.abs(hz)
  if (abs >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`
  if (abs >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`
  if (abs >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`
  return `${hz.toFixed(1)} Hz`
}

export function formatSampleRate(rate: number): string {
  if (rate >= 1e6) return `${(rate / 1e6).toFixed(2)} MSps`
  if (rate >= 1e3) return `${(rate / 1e3).toFixed(2)} kSps`
  return `${rate.toFixed(0)} Sps`
}
