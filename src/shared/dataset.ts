import type { EventProject, EventProposal } from './detection'
import type { CaptureSegment } from './sigmf'

export type DatasetMode = 'manifest' | 'iq' | 'channelized'
export interface DatasetRequest { recordingId: string; mode: DatasetMode; expectedRevision: number }
export interface DatasetJob {
  id: string
  recordingId: string
  status: 'running' | 'complete' | 'cancelled' | 'failed'
  stage: 'hashing' | 'writing' | 'complete'
  completed: number
  total: number
  eventCount: number
  outputPath?: string
  error?: string
}
export interface ChannelRecipe {
  version: 'snail-channel-1'
  mixFrequencyHz: number
  phaseOriginSample: number
  sampleRate: number
  outputSampleRate: number
  decimation: 1
  coefficients: number[]
  passbandHalfWidthHz: number
  transitionHz: number
  contextSamples: number
  alignment: 'centered-fir'
  boundary: 'zero-pad-at-capture-boundaries'
}
export interface DatasetEvent {
  event: EventProposal
  capture: CaptureSegment
  split: 'unassigned'
  groupId: string
  sourceMapping: { startSample: number; sampleStep: 1; sampleCount: number }
  recipe: ChannelRecipe | null
  iq?: { path: string; metadataPath: string; datatype: 'cf32_le'; sampleRate: number; sampleCount: number; sha256: string }
}
export interface DatasetManifest {
  schemaVersion: 1
  generator: 'snail-dataset-1'
  createdAt: string
  mode: DatasetMode
  source: EventProject['source'] & { sha256: string; captures: CaptureSegment[]; metadata: Record<string, unknown> | null }
  project: { sourceKey: string; revision: number; runs: EventProject['runs'] }
  events: DatasetEvent[]
}
