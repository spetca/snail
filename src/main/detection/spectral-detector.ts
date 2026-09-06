import { matchesEventFilters, type DetectedEvent, type DetectionConfig, type DetectionFrequencyRange } from '../../shared/detection'

interface Run { low: number; high: number; peak: number; strong: boolean }
interface Track { start: number; end: number; low: number; high: number; peak: number; frames: number; lastFrame: number; counted: number; runs: Run[]; parent?: Track }

export function validateDetectionConfig(config: DetectionConfig): void {
  if (!config || (config.thresholdMode != null && !['relative', 'absolute'].includes(config.thresholdMode)) || ![128, 256, 512, 1024, 2048].includes(config.fftSize) ||
    !Number.isFinite(config.thresholdDb) || config.thresholdDb < 3 || config.thresholdDb > 60 ||
    !Number.isFinite(config.minimumPowerDb) || config.minimumPowerDb < -200 || config.minimumPowerDb > 0 ||
    !Number.isInteger(config.minFrames) || config.minFrames < 1 || config.minFrames > 1000 ||
    !Number.isInteger(config.minBins) || config.minBins < 1 || config.minBins > config.fftSize ||
    !Number.isInteger(config.maxGapFrames) || config.maxGapFrames < 0 || config.maxGapFrames > 16) {
    throw new Error('Invalid detector settings')
  }
  for (const [minimum, maximum, name] of [
    [config.minPulseWidthSeconds, config.maxPulseWidthSeconds, 'pulse width'],
    [config.minBandwidthHz, config.maxBandwidthHz, 'bandwidth']
  ] as const) {
    if ((minimum != null && (!Number.isFinite(minimum) || minimum < 0)) ||
        (maximum != null && (!Number.isFinite(maximum) || maximum <= 0)) ||
        (minimum != null && maximum != null && minimum > maximum)) {
      throw new Error(`Invalid ${name} range: use nonnegative minimum, positive maximum, and minimum ≤ maximum`)
    }
  }
}

export function detectionBins(fftSize: number, sampleRate: number, range?: DetectionFrequencyRange) {
  if (range && (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low >= range.high ||
    range.low < -sampleRate / 2 || range.high > sampleRate / 2)) throw new Error('Invalid detection frequency range')
  const first = range ? Math.max(0, Math.ceil((range.low / sampleRate + 0.5) * fftSize)) : 0
  const last = range ? Math.min(fftSize - 1, Math.floor((range.high / sampleRate + 0.5) * fftSize)) : fftSize - 1
  if (last < first) throw new Error('Visible frequency range contains no detector bins; increase detection FFT size or zoom out')
  return { first, last }
}

/** Streaming connected spectral regions. State is independent of FFT tile boundaries. */
export class SpectralDetector {
  private active = new Set<Track>()
  private frame = 0
  private expectedStart: number
  readonly stride: number
  private firstBin: number
  private lastBin: number

  constructor(private config: DetectionConfig, private sampleRate: number,
    private rangeStart: number, private rangeEnd: number, private emit: (event: DetectedEvent) => void, private frequencyRange?: DetectionFrequencyRange) {
    validateDetectionConfig(config)
    const bins = detectionBins(config.fftSize, sampleRate, frequencyRange)
    this.firstBin = bins.first; this.lastBin = bins.last
    this.stride = config.fftSize / 2
    this.expectedStart = rangeStart
  }

  private root(track: Track): Track {
    while (track.parent) track = track.parent
    return track
  }

  private finishTrack(track: Track): void {
    const n = this.config.fftSize
    if (track.frames < this.config.minFrames || track.high - track.low + 1 < this.config.minBins) return
    const event: DetectedEvent = { sampleStart: track.start, sampleCount: track.end - track.start,
      freqLowerEdge: Math.max(this.frequencyRange?.low ?? -this.sampleRate / 2, ((track.low - 0.5) / n - 0.5) * this.sampleRate),
      freqUpperEdge: Math.min(this.frequencyRange?.high ?? this.sampleRate / 2, ((track.high + 0.5) / n - 0.5) * this.sampleRate),
      peakAboveNoiseDb: track.peak, frames: track.frames,
      touchesBoundary: track.start === this.rangeStart || track.end === this.rangeEnd }
    if (matchesEventFilters(event, this.sampleRate, this.config)) this.emit(event)
  }

  push(startSample: number, data: Float32Array): void {
    const n = this.config.fftSize
    if (startSample !== this.expectedStart || data.length % n !== 0) throw new Error('Noncontiguous or malformed detector FFT tile')
    for (let offset = 0; offset < data.length && this.expectedStart < this.rangeEnd; offset += n) {
      const start = this.expectedStart
      this.expectedStart += this.stride
      const frame = this.frame++
      const row = data.subarray(offset, offset + n)
      if (row.some(power => !Number.isFinite(power))) throw new Error('Nonfinite power in detector FFT tile')
      const sorted = Float32Array.from(row.subarray(this.firstBin, this.lastBin + 1)).sort()
      const noise = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
      const highThreshold = this.config.thresholdMode === 'absolute' ? this.config.minimumPowerDb : Math.max(this.config.minimumPowerDb, noise + this.config.thresholdDb)
      const lowThreshold = this.config.thresholdMode === 'absolute' ? highThreshold - 4 : Math.max(this.config.minimumPowerDb, noise + this.config.thresholdDb - 4)
      const runs: Run[] = []
      for (let bin = this.firstBin; bin <= this.lastBin;) {
        if (row[bin] <= lowThreshold) { ++bin; continue }
        const low = bin
        let peak = row[bin]
        while (bin <= this.lastBin && row[bin] > lowThreshold) { peak = Math.max(peak, row[bin]); ++bin }
        runs.push({ low, high: bin - 1, peak: peak - noise, strong: peak > highThreshold })
      }
      const previous = Array.from(this.active).map(track => this.root(track)).filter((track, i, all) => all.indexOf(track) === i)
      this.active.clear()
      const live = previous.filter(track => {
        if (frame - track.lastFrame > this.config.maxGapFrames + 1) { this.finishTrack(track); return false }
        return true
      })
      const nextRuns = new Map<Track, Run[]>()
      for (const run of runs) {
        const matches = live.filter(track => track.runs.some(old => run.low <= old.high + 1 && run.high >= old.low - 1))
          .map(track => this.root(track)).filter((track, i, all) => all.indexOf(track) === i)
        if (!matches.length && !run.strong) continue
        const track = matches[0] ?? { start, end: start, low: run.low, high: run.high,
          peak: run.peak, frames: 0, lastFrame: frame, counted: -1, runs: [] }
        for (const other of matches.slice(1)) {
          other.parent = track
          track.start = Math.min(track.start, other.start)
          track.low = Math.min(track.low, other.low)
          track.high = Math.max(track.high, other.high)
          track.peak = Math.max(track.peak, other.peak)
          // Duration support, not a sum of overlapping components' frame counts.
          track.frames = Math.max(track.frames, other.frames)
          if (other.counted === frame) track.counted = frame
        }
        if (track.counted !== frame) { ++track.frames; track.counted = frame }
        track.lastFrame = frame
        track.end = Math.min(this.rangeEnd, start + n)
        track.low = Math.min(track.low, run.low)
        track.high = Math.max(track.high, run.high)
        track.peak = Math.max(track.peak, run.peak)
        nextRuns.set(track, [...(nextRuns.get(track) ?? []), run])
        this.active.add(track)
      }
      for (const track of live) this.active.add(this.root(track))
      // Merge current runs after all unions, so split/merge signals stay connected.
      const merged = new Map<Track, Run[]>()
      for (const [track, bins] of nextRuns) {
        const root = this.root(track)
        merged.set(root, [...(merged.get(root) ?? []), ...bins])
      }
      this.active = new Set(Array.from(this.active, track => this.root(track)))
      for (const [track, bins] of merged) track.runs = bins
    }
  }

  finish(): void {
    for (const track of this.active) this.finishTrack(track)
    this.active.clear()
  }
}
