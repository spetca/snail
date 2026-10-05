import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseMetadata } from '../shared/sigmf'
import { FORMAT_EXTENSIONS, SAMPLE_BYTE_SIZES, type SampleFormat, type OpenOptions } from '../shared/sample-formats'

/** Resolve a collection without concatenating unrelated recording sample clocks. */
export function resolveRecording(filePath: string, opts: OpenOptions = {}) {
  if (!filePath.endsWith('.sigmf-collection')) return { path: filePath }
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const collection = doc?.collection
  if (!collection || Object.keys(doc).length !== 1 || typeof collection['core:version'] !== 'string' || !Array.isArray(collection['core:streams'])) {
    throw new Error('Invalid SigMF collection')
  }
  const streams = collection['core:streams'].map((entry: any) => {
    const [name, hash] = Array.isArray(entry) ? entry : [entry?.name, entry?.hash]
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/]/.test(name) ||
        typeof hash !== 'string' || !/^[a-f\d]{128}$/i.test(hash) || (Array.isArray(entry) && entry.length !== 2)) {
      throw new Error('Invalid SigMF collection recording name or SHA512 hash')
    }
    return { name, hash }
  }) as { name: string; hash: string }[]
  const streamIndex = opts.streamIndex ?? 0
  if (!Number.isSafeInteger(streamIndex) || streamIndex < 0 || streamIndex >= streams.length) throw new Error('Collection stream index is out of range')
  const stream = streams[streamIndex]
  const metaPath = path.join(path.dirname(filePath), stream.name + '.sigmf-meta')
  const bytes = fs.readFileSync(metaPath)
  if (createHash('sha512').update(bytes).digest('hex') !== stream.hash.toLowerCase()) {
    throw new Error(`SigMF metadata hash mismatch for ${stream.name}`)
  }
  return { path: metaPath, collection: { path: filePath, streamIndex, streams } }
}

export function probeRecording(filePath: string) {
  const resolved = resolveRecording(filePath)
  const metaPath = /\.sigmf-(data|meta)$/.test(resolved.path) ? resolved.path.replace(/\.sigmf-(data|meta)$/, '.sigmf-meta') : ''
  const meta = metaPath && fs.existsSync(metaPath) ? parseMetadata(fs.readFileSync(metaPath, 'utf8')) : undefined
  const global = meta?.global ?? {}
  const datatype = global['core:datatype']
  const format = (datatype ? datatype.replace(/_(le|be)$/, '').replace('i', 's') : FORMAT_EXTENSIONS[path.extname(resolved.path)] ?? 'cf32') as SampleFormat
  if (!(format in SAMPLE_BYTE_SIZES)) throw new Error(`Unsupported SigMF datatype: ${datatype}`)
  const numChannels = global['core:num_channels'] ?? 1
  if (!Number.isSafeInteger(numChannels) || numChannels < 1) throw new Error('Invalid SigMF core:num_channels')
  const dataset = global['core:dataset']
  if (dataset !== undefined && (typeof dataset !== 'string' || !dataset || dataset === '.' || dataset === '..' || /[\\/]/.test(dataset))) {
    throw new Error('SigMF core:dataset must be a filename in the metadata directory')
  }
  const dataPath = dataset ? path.join(path.dirname(metaPath), dataset) : resolved.path.replace(/\.sigmf-meta$/, '.sigmf-data')
  const stat = fs.statSync(dataPath)
  return { totalSamples: Math.floor(stat.size / (SAMPLE_BYTE_SIZES[format] * numChannels)),
    sampleRate: global['core:sample_rate'] ?? 1000000, format, fileSize: stat.size,
    centerFrequency: meta?.captures?.[0]?.['core:frequency'], numChannels }
}
