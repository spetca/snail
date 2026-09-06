import type { FileInfo, SigMFAnnotation } from './sample-formats'

export type AnnotationFrequencyMode = 'rf' | 'legacy-baseband'
export type SigMFDocument = Record<string, any>
export interface CaptureSegment { start: number; end: number; frequency: number }

export function parseMetadata(json: string): SigMFDocument {
  const meta = JSON.parse(json)
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid SigMF metadata object')
  for (const field of ['captures', 'annotations']) {
    if (meta[field] !== undefined && !Array.isArray(meta[field])) throw new Error(`Invalid SigMF ${field}`)
  }
  return meta
}

export function captureSegments(info: FileInfo): CaptureSegment[] {
  let meta: SigMFDocument | null = null
  try { meta = info.sigmfMetaJson ? parseMetadata(info.sigmfMetaJson) : null }
  catch { return [{ start: 0, end: info.totalSamples, frequency: info.centerFrequency ?? 0 }] }
  const captures = (meta?.captures ?? []) as SigMFDocument[]
  const points = captures.map(capture => ({
    start: capture['core:sample_start'] ?? 0,
    // Capture properties do not carry forward from an earlier capture.
    frequency: Number.isFinite(capture['core:frequency']) ? capture['core:frequency'] : 0
  })).filter(capture => Number.isSafeInteger(capture.start) && capture.start >= 0 && capture.start < info.totalSamples)
    .sort((a, b) => a.start - b.start)
  if (!points.length || points[0].start > 0) {
    points.unshift({ start: 0, frequency: meta ? 0 : info.centerFrequency ?? 0 })
  }
  return points.map((point, index) => ({ ...point, end: points[index + 1]?.start ?? info.totalSamples }))
}

export function centerFrequencyAt(info: FileInfo | null, sample: number): number {
  if (!info) return 0
  return captureSegments(info).find(capture => sample >= capture.start && sample < capture.end)?.frequency ?? 0
}

export function annotationFromRecord(record: SigMFDocument, info: FileInfo, captures = captureSegments(info)): SigMFAnnotation {
  const sampleStart = record['core:sample_start'] ?? 0
  const captureEnd = captures.find(capture => sampleStart >= capture.start && sampleStart < capture.end)?.end ?? info.totalSamples
  return {
    sampleStart,
    sampleCount: record['core:sample_count'] ?? Math.max(0, captureEnd - sampleStart),
    freqLowerEdge: record['core:freq_lower_edge'], freqUpperEdge: record['core:freq_upper_edge'],
    label: record['core:label'], comment: record['core:comment']
  }
}

export function readAnnotations(info: FileInfo): SigMFAnnotation[] {
  if (!info.sigmfMetaJson) return []
  const captures = captureSegments(info)
  return (parseMetadata(info.sigmfMetaJson).annotations ?? []).map((record: SigMFDocument) => annotationFromRecord(record, info, captures))
}

export function splitAnnotation(annotation: SigMFAnnotation, info: FileInfo, captures = captureSegments(info)) {
  const end = annotation.sampleStart + annotation.sampleCount
  return captures.flatMap(capture => {
    const start = Math.max(capture.start, annotation.sampleStart)
    const stop = Math.min(capture.end, end)
    return stop > start ? [{ ...annotation, sampleStart: start, sampleCount: stop - start, centerFrequency: capture.frequency }] : []
  })
}

/** Convert SigMF RF edges to baseband separately in every intersected capture. */
export function annotationBands(annotations: SigMFAnnotation[], info: FileInfo, mode: AnnotationFrequencyMode) {
  const captures = captureSegments(info)
  return annotations.flatMap((annotation, index) => splitAnnotation(annotation, info, captures).map(segment => ({
    index,
    annotation: {
      ...segment,
      freqLowerEdge: segment.freqLowerEdge == null ? undefined : segment.freqLowerEdge - (mode === 'rf' ? segment.centerFrequency : 0),
      freqUpperEdge: segment.freqUpperEdge == null ? undefined : segment.freqUpperEdge - (mode === 'rf' ? segment.centerFrequency : 0)
    }
  })))
}

/** A new cursor annotation enters in baseband coordinates and is stored at RF. */
export function annotationRecords(annotation: SigMFAnnotation, info: FileInfo): SigMFDocument[] {
  const { sampleStart, sampleCount, freqLowerEdge: low, freqUpperEdge: high } = annotation
  if (!Number.isSafeInteger(sampleStart) || !Number.isSafeInteger(sampleCount) || sampleStart < 0 || sampleCount <= 0 || sampleStart + sampleCount > info.totalSamples) {
    throw new Error('Select a nonempty sample range inside the recording')
  }
  if ((low == null) !== (high == null) || (low != null && (!Number.isFinite(low) || !Number.isFinite(high) || low >= high! || low < -info.sampleRate / 2 || high! > info.sampleRate / 2))) {
    throw new Error('Select valid frequency bounds inside the recording bandwidth')
  }
  return splitAnnotation(annotation, info).map(segment => ({
    'core:sample_start': segment.sampleStart,
    'core:sample_count': segment.sampleCount,
    ...(low == null ? {} : {
      'core:freq_lower_edge': low + segment.centerFrequency,
      'core:freq_upper_edge': high! + segment.centerFrequency
    }),
    ...(annotation.label ? { 'core:label': annotation.label } : {}),
    ...(annotation.comment ? { 'core:comment': annotation.comment } : {}),
    'core:generator': 'Snail'
  }))
}
