import type { ChannelRecipe } from '../../shared/dataset'

/** Hann-windowed sinc, normalized at DC. No decimation: one output per input sample. */
export function channelRecipe(low: number, high: number, sampleRate: number, phaseOriginSample: number): ChannelRecipe {
  if (![low, high, sampleRate].every(Number.isFinite) || sampleRate <= 0 || low >= high || low < -sampleRate / 2 || high > sampleRate / 2) {
    throw new Error('Invalid channel bounds')
  }
  const width = high - low
  const transitionHz = Math.min(width / 4, (sampleRate - width) * 0.45)
  if (transitionHz <= 0) throw new Error('Full-band events should use unfiltered IQ export')
  const requiredTaps = Math.ceil(4 * sampleRate / transitionHz)
  if (requiredTaps > 2049) throw new Error('Channel is too narrow for this filter limit. Export unfiltered IQ; multistage resampling is not yet available.')
  const taps = requiredTaps | 1
  const half = (taps - 1) / 2, cutoff = (width / 2 + transitionHz / 2) / sampleRate
  const coefficients = Array.from({ length: taps }, (_, k) => {
    const x = k - half
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
    return sinc * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (taps - 1)))
  })
  const sum = coefficients.reduce((a, b) => a + b, 0)
  return { version: 'snail-channel-1', mixFrequencyHz: (low + high) / 2, phaseOriginSample,
    sampleRate, outputSampleRate: sampleRate, decimation: 1, coefficients: coefficients.map(x => x / sum),
    passbandHalfWidthHz: width / 2, transitionHz, contextSamples: half,
    alignment: 'centered-fir', boundary: 'zero-pad-at-capture-boundaries' }
}

/** Input includes FIR context; its sample zero is inputStart in source coordinates. */
export function channelize(input: Float32Array, inputStart: number, outputStart: number, count: number, recipe: ChannelRecipe): Float32Array {
  const mixed = new Float64Array(input.length)
  const ratio = recipe.mixFrequencyHz / recipe.sampleRate
  // Phase referenced to event start and recomputed per source sample: independent of chunk boundaries.
  for (let i = 0; i < input.length / 2; i++) {
    const phase = 2 * Math.PI * (((inputStart + i - recipe.phaseOriginSample) * ratio) % 1)
    const c = Math.cos(phase), s = Math.sin(phase)
    mixed[2*i] = input[2*i] * c + input[2*i+1] * s
    mixed[2*i+1] = input[2*i+1] * c - input[2*i] * s
  }
  const output = new Float32Array(count * 2), h = recipe.coefficients
  for (let n = 0; n < count; n++) {
    let real = 0, imag = 0
    const first = outputStart + n - recipe.contextSamples - inputStart
    for (let k = 0; k < h.length; k++) {
      const index = first + k
      if (index < 0 || index >= input.length / 2) continue
      real += mixed[2*index] * h[k]; imag += mixed[2*index+1] * h[k]
    }
    output[2*n] = real; output[2*n+1] = imag
  }
  return output
}
