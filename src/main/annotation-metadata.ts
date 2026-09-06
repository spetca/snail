import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileInfo, SigMFAnnotation } from '../shared/sample-formats'
import { annotationFromRecord, annotationRecords, parseMetadata, splitAnnotation, type AnnotationFrequencyMode, type SigMFDocument } from '../shared/sigmf'

export function metadataPaths(filePath: string) {
  if (/\.sigmf-(data|meta)$/.test(filePath)) {
    return { meta: filePath.replace(/\.sigmf-(data|meta)$/, '.sigmf-meta'), data: filePath.replace(/\.sigmf-(data|meta)$/, '.sigmf-data') }
  }
  return { meta: filePath + '.sigmf-meta', data: filePath }
}

export function saveAnnotationMetadata(info: FileInfo, annotation: SigMFAnnotation, mode: AnnotationFrequencyMode, annotationId?: string): string {
  const paths = metadataPaths(info.path)
  let meta: SigMFDocument
  try {
    meta = parseMetadata(fs.readFileSync(paths.meta, 'utf8'))
  } catch (error: any) {
    // Malformed metadata and I/O errors must never be replaced with an empty document.
    if (error.code !== 'ENOENT') throw error
    meta = {
      global: { 'core:datatype': info.format + (info.format.endsWith('8') ? '' : '_le'),
        'core:version': '1.2.5', 'core:sample_rate': info.sampleRate,
        'core:dataset': path.basename(paths.data) },
      captures: [{ 'core:sample_start': 0, ...(info.centerFrequency == null ? {} : { 'core:frequency': info.centerFrequency }) }],
      annotations: []
    }
  }
  meta.global = { ...meta.global, 'core:sample_rate': info.sampleRate }
  const source = { ...info, sigmfMetaJson: JSON.stringify(meta) }
  const additions = annotationRecords(annotation, source)
  if (annotationId) {
    if (additions.length !== 1) throw new Error('A review proposal must belong to one capture')
    additions[0]['core:uuid'] = annotationId
    const existing = (meta.annotations ?? []).find((record: SigMFDocument) => record['core:uuid'] === annotationId)
    if (existing) {
      if (Object.keys(additions[0]).some(key => existing[key] !== additions[0][key])) {
        throw new Error('An annotation with this proposal ID already exists with different content')
      }
      return JSON.stringify(meta, null, 2)
    }
  }
  let previous: SigMFDocument[] = meta.annotations ?? []
  if (mode === 'legacy-baseband') {
    // Explicit user-selected interpretation; no guessing based on frequency magnitude.
    previous = previous.flatMap(record => {
      if (record['core:freq_lower_edge'] == null && record['core:freq_upper_edge'] == null) return [record]
      const parsed = annotationFromRecord(record, source)
      // Validate legacy bounds before altering any metadata.
      annotationRecords(parsed, source)
      const parts = splitAnnotation(parsed, source)
      return parts.map(part => ({ ...record,
        'core:sample_start': part.sampleStart, 'core:sample_count': part.sampleCount,
        'core:freq_lower_edge': part.freqLowerEdge! + part.centerFrequency,
        'core:freq_upper_edge': part.freqUpperEdge! + part.centerFrequency,
        ...(parts.length > 1 && record['core:uuid'] ? { 'core:uuid': randomUUID() } : {})
      }))
    })
  }
  meta.annotations = [...previous, ...additions]
    .sort((a, b) => a['core:sample_start'] - b['core:sample_start'])
  const text = JSON.stringify(meta, null, 2)
  const temporary = paths.meta + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' })
    fs.renameSync(temporary, paths.meta)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return text
}
