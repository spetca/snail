export type SampleFormat =
  | 'cf32'   // Complex float32 (I/Q interleaved)
  | 'cf64'   // Complex float64
  | 'cs32'   // Complex signed int32
  | 'cs16'   // Complex signed int16
  | 'cs8'    // Complex signed int8
  | 'cu8'    // Complex unsigned int8
  | 'rf32'   // Real float32
  | 'rf64'   // Real float64
  | 'rs16'   // Real signed int16
  | 'rs8'    // Real signed int8
  | 'ru8'    // Real unsigned int8

export interface SigMFAnnotation {
  sampleStart: number
  sampleCount: number
  freqLowerEdge?: number
  freqUpperEdge?: number
  label?: string
  comment?: string
}

export interface FileInfo {
  path: string
  format: SampleFormat
  sampleRate: number
  totalSamples: number
  fileSize: number
  centerFrequency?: number
  sigmfMetaJson?: string
}

export interface FFTTileRequest {
  startSample: number
  fftSize: number
  stride: number
}

export interface ExportConfig {
  outputPath: string
  startSample: number
  endSample: number
  description?: string
  author?: string
  applyBandpass: boolean
  bandpassLow?: number
  bandpassHigh?: number
  sampleRate: number
  centerFrequency?: number
}

export interface CorrelateRequest {
  mode: 'file' | 'self'
  windowStart: number
  windowLength: number
  // For 'file' mode
  patternFilePath?: string
  patternFileFormat?: SampleFormat
  // For 'self' mode
  tu?: number
  cpLen?: number
}

export interface FFTConfigRequest {
  startSample: number
  length: number
  fftSize: number
  window: 'none' | 'hann' | 'hamming' | 'blackman'
  shift: boolean
  scale: 'abs' | 'log'
  sampleRate?: number
}

export interface FFTResult {
  data: Float32Array
  frequencies?: Float32Array
  maxPower: number
  minPower: number
}

export const FORMAT_EXTENSIONS: Record<string, SampleFormat> = {
  '.cf32': 'cf32',
  '.fc32': 'cf32',
  '.cfile': 'cf32',
  '.raw': 'cf32',
  '.iq': 'cf32',
  '.cf64': 'cf64',
  '.cs32': 'cs32',
  '.cs16': 'cs16',
  '.sc16': 'cs16',
  '.cs8': 'cs8',
  '.sc8': 'cs8',
  '.cu8': 'cu8',
  '.sigmf-data': 'cf32',
  '.rf32': 'rf32',
  '.rf64': 'rf64',
  '.rs16': 'rs16',
  '.rs8': 'rs8',
  '.ru8': 'ru8'
}

export const SAMPLE_BYTE_SIZES: Record<SampleFormat, number> = {
  cf32: 8,
  cf64: 16,
  cs32: 8,
  cs16: 4,
  cs8: 2,
  cu8: 2,
  rf32: 4,
  rf64: 8,
  rs16: 2,
  rs8: 1,
  ru8: 1
}
