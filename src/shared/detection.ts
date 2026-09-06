import type { AnnotationFrequencyMode } from './sigmf'

export const DETECTOR_VERSION = 'spectral-energy-1'
export interface DetectionConfig {
  thresholdMode?: 'relative' | 'absolute' // omitted in older saved runs: relative
  fftSize: number
  thresholdDb: number // above the median spectral-bin power in each FFT frame
  minimumPowerDb: number
  minFrames: number
  minBins: number
  maxGapFrames: number
  minPulseWidthSeconds?: number
  maxPulseWidthSeconds?: number
  minBandwidthHz?: number
  maxBandwidthHz?: number
}
export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  fftSize: 512, thresholdDb: 12, minimumPowerDb: -110, minFrames: 3, minBins: 2, maxGapFrames: 1
}
export interface EventBounds {
  sampleStart: number
  sampleCount: number
  freqLowerEdge: number // baseband Hz
  freqUpperEdge: number
}
export interface DetectedEvent extends EventBounds {
  peakAboveNoiseDb: number
  frames: number
  touchesBoundary: boolean
}
export type ReviewStatus = 'proposed' | 'accepted' | 'rejected'
export interface ProposalRevision {
  revision: number
  at: string
  action: 'propose' | 'edit' | 'accept' | 'reject' | 'restore'
  status: ReviewStatus
  label: string
  comment: string
  bounds: EventBounds
}
export interface EventProposal extends DetectedEvent {
  id: string
  fingerprint: string
  runId: string
  revision: number
  status: ReviewStatus
  label: string
  comment: string
  history: ProposalRevision[]
}
export interface DetectionFrequencyRange { low: number; high: number }

export interface DetectionRun {
  frequencyRange?: DetectionFrequencyRange
  id: string
  detectorVersion: string
  config: DetectionConfig
  startSample: number
  endSample: number
  sampleRate: number
  startedAt: string
  finishedAt?: string
  status: 'running' | 'complete' | 'cancelled' | 'failed' | 'limited'
  processedUntil: number
  candidateCount: number
  error?: string
}
export interface EventProject {
  schemaVersion: 1
  sourceKey: string
  source: { path: string; size: number; modifiedMs: number; totalSamples: number; sampleRate: number; format: string }
  revision: number
  proposals: EventProposal[]
  runs: DetectionRun[]
}
export interface DetectionState {
  recordingId: string
  project?: EventProject
  progress: DetectionRun | null
}
export interface StartDetectionRequest {
  frequencyRange?: DetectionFrequencyRange
  recordingId: string
  startSample: number
  endSample: number
  config: DetectionConfig
}
export interface ReviewProposalRequest {
  recordingId: string
  proposalId: string
  expectedRevision: number
  action: 'edit' | 'accept' | 'reject' | 'restore'
  patch?: EventBounds & { label: string; comment: string }
  frequencyMode: AnnotationFrequencyMode
}
export interface ReviewProposalResult {
  project: EventProject
  sigmfMetaJson?: string
}

/** Inclusive filters on the detected rectangle, including bridged gaps and FFT support. */
export function matchesEventFilters(event: EventBounds, sampleRate: number, config: DetectionConfig): boolean {
  const duration = event.sampleCount / sampleRate
  const bandwidth = event.freqUpperEdge - event.freqLowerEdge
  return (config.minPulseWidthSeconds == null || duration >= config.minPulseWidthSeconds) &&
    (config.maxPulseWidthSeconds == null || duration <= config.maxPulseWidthSeconds) &&
    (config.minBandwidthHz == null || bandwidth >= config.minBandwidthHz) &&
    (config.maxBandwidthHz == null || bandwidth <= config.maxBandwidthHz)
}
