import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
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
  let original: string | undefined
  let meta: SigMFDocument
  try {
    original = fs.readFileSync(paths.meta, 'utf8')
    meta = parseMetadata(original)
  } catch (error: any) {
    // Malformed metadata and I/O errors must never be replaced with an empty document.
    if (error.code !== 'ENOENT') throw error
    meta = {
      global: { 'core:datatype': info.format.replace('s', 'i') + (info.format.endsWith('8') ? '' : '_le'),
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
        'core:sample_start': part.sampleStart + (meta.global?.['core:offset'] ?? 0), 'core:sample_count': part.sampleCount,
        'core:freq_lower_edge': part.freqLowerEdge! + part.centerFrequency,
        'core:freq_upper_edge': part.freqUpperEdge! + part.centerFrequency,
        ...(parts.length > 1 && record['core:uuid'] ? { 'core:uuid': randomUUID() } : {})
      }))
    })
  }
  meta.annotations = [...previous, ...additions]
    .sort((a, b) => a['core:sample_start'] - b['core:sample_start'])
  const text = JSON.stringify(meta, null, 2)
  // Collection hashes cover metadata bytes, so annotation edits must update membership too.
  const collectionName = meta.global?.['core:collection']
  const collectionPath = info.collection?.path ?? (typeof collectionName === 'string' && collectionName && !/[\\/]/.test(collectionName) && collectionName !== '.' && collectionName !== '..'
    ? path.join(path.dirname(paths.meta), collectionName + '.sigmf-collection') : undefined)
  if (info.collection && !fs.existsSync(info.collection.path)) throw new Error('SigMF collection file is missing; cannot update its metadata hash')
  let collectionText: string | undefined
  if (collectionPath && fs.existsSync(collectionPath)) {
    const doc = JSON.parse(fs.readFileSync(collectionPath, 'utf8'))
    const entries = doc?.collection?.['core:streams']
    if (!Array.isArray(entries)) throw new Error('Invalid SigMF collection; cannot update metadata hash')
    const name = path.basename(paths.meta, '.sigmf-meta')
    const hash = createHash('sha512').update(text).digest('hex')
    let matched = false
    for (const entry of entries) {
      if ((Array.isArray(entry) ? entry[0] : entry.name) !== name) continue
      const previousHash = Array.isArray(entry) ? entry[1] : entry.hash
      if (!original || previousHash?.toLowerCase() !== createHash('sha512').update(original).digest('hex'))
        throw new Error('SigMF collection metadata hash mismatch; reopen the recording before editing')
      if (Array.isArray(entry)) entry[1] = hash
      else entry.hash = hash
      matched = true
    }
    if (!matched) throw new Error('Recording is absent from its SigMF collection')
    collectionText = JSON.stringify(doc, null, 2)
  }
  const temporary = paths.meta + '.' + randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' })
    // Stage both files before replacing either. Roll back metadata if collection replacement fails.
    const collectionTemporary = collectionPath + '.' + randomUUID() + '.tmp'
    try {
      if (collectionText) fs.writeFileSync(collectionTemporary, collectionText, { flag: 'wx' })
      fs.renameSync(temporary, paths.meta)
      try { if (collectionText) fs.renameSync(collectionTemporary, collectionPath!) }
      catch (error) {
        fs.writeFileSync(temporary, original!)
        fs.renameSync(temporary, paths.meta)
        throw error
      }
    } finally { if (fs.existsSync(collectionTemporary)) fs.unlinkSync(collectionTemporary) }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return text
}
