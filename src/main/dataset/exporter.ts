import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { FileInfo } from '../../shared/sample-formats'
import type { EventProject } from '../../shared/detection'
import type { DatasetJob, DatasetManifest, DatasetMode, DatasetEvent } from '../../shared/dataset'
import { annotationRecords, captureSegments, parseMetadata } from '../../shared/sigmf'
import { metadataPaths } from '../annotation-metadata'
import type { RecordingSession } from '../recording-session'
import { PYTHON_READER } from './python-reader'
import { channelRecipe, channelize } from './channelizer'

const CHUNK = 2048
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
class Cancelled extends Error {}

export class DatasetExporter {
  private job: DatasetJob | null = null
  private cancelled = false
  private task: Promise<void> = Promise.resolve()
  constructor(private session: RecordingSession, private readSamples: (start: number, count: number) => Float32Array | Promise<Float32Array>) {}

  state(recordingId: string): DatasetJob | null {
    this.session.assertCurrent(recordingId)
    return this.job?.recordingId === recordingId ? clone(this.job) : null
  }
  cancel(recordingId: string, id: string): void {
    this.session.assertCurrent(recordingId)
    if (this.job?.id === id && this.job.recordingId === recordingId) this.cancelled = true
  }
  settled(): Promise<void> { return this.task }

  start(recordingId: string, project: EventProject, mode: DatasetMode, destination: string): DatasetJob {
    const info = clone(this.session.assertCurrent(recordingId))
    if (this.job?.status === 'running') throw new Error('A dataset export is already running')
    if (!['manifest', 'iq', 'channelized'].includes(mode)) throw new Error('Invalid dataset export mode')
    if (info.fileTotal != null && info.fileTotal !== info.totalSamples) throw new Error('Open the full recording before exporting a dataset')
    const snapshot = clone(project), proposals = snapshot.proposals.filter(p => p.status === 'accepted')
    if (!proposals.length) throw new Error('Accept at least one event before exporting')
    if (snapshot.runs.some(run => run.status === 'running')) throw new Error('Finish or cancel detection before exporting')
    if (info.sigmfMetaJson) parseMetadata(info.sigmfMetaJson)
    const captures = captureSegments(info)
    for (const event of proposals) {
      if (!event.label || !Number.isFinite(event.freqLowerEdge) || !Number.isFinite(event.freqUpperEdge) || annotationRecords(event, info).length !== 1) {
        throw new Error('Accepted event has invalid bounds or label')
      }
      if (mode === 'channelized') channelRecipe(event.freqLowerEdge, event.freqUpperEdge, info.sampleRate, event.sampleStart)
    }
    const sourcePath = fs.realpathSync(metadataPaths(info.path).data)
    if (sourcePath !== snapshot.source.path || info.sampleRate !== snapshot.source.sampleRate || info.totalSamples !== snapshot.source.totalSamples || info.format !== snapshot.source.format) {
      throw new Error('Review project does not match the open recording')
    }
    this.checkSource(snapshot)
    if (!fs.statSync(destination).isDirectory()) throw new Error('Choose a destination folder')
    const job: DatasetJob = { id: randomUUID(), recordingId, status: 'running', stage: 'hashing', completed: 0,
      total: snapshot.source.size, eventCount: proposals.length }
    this.job = job; this.cancelled = false
    const manifest: DatasetManifest = { schemaVersion: 1, generator: 'snail-dataset-1', createdAt: new Date().toISOString(), mode,
      source: { ...snapshot.source, sha256: '', captures, metadata: info.sigmfMetaJson ? parseMetadata(info.sigmfMetaJson) : null },
      project: { sourceKey: snapshot.sourceKey, revision: snapshot.revision, runs: snapshot.runs }, events: [] }
    this.task = this.write(info, snapshot, manifest, destination, job)
    return clone(job)
  }

  private checkSource(project: EventProject): void {
    const stat = fs.statSync(project.source.path)
    if (stat.size !== project.source.size || stat.mtimeMs !== project.source.modifiedMs) throw new Error('Recording changed on disk; reopen it before exporting')
  }
  private checkpoint(info: FileInfo, project: EventProject): void {
    if (this.cancelled || !this.session.isCurrent(info.recordingId)) throw new Cancelled('Export cancelled or recording changed')
    this.checkSource(project)
  }

  private async write(info: FileInfo, project: EventProject, manifest: DatasetManifest, destination: string, job: DatasetJob): Promise<void> {
    const staging = path.join(destination, `.snail-dataset-${job.id}.partial`)
    const output = path.join(destination, `snail-dataset-${job.id}`)
    let createdStaging = false
    try {
      await fs.promises.mkdir(staging)
      createdStaging = true
      const sourceHash = createHash('sha256')
      for await (const data of fs.createReadStream(project.source.path, { highWaterMark: 1024 * 1024 })) {
        this.checkpoint(info, project)
        sourceHash.update(data); job.completed += data.length
      }
      this.checkpoint(info, project)
      manifest.source.sha256 = sourceHash.digest('hex')
      const accepted = project.proposals.filter(p => p.status === 'accepted')
      job.stage = 'writing'; job.completed = 0
      job.total = manifest.mode === 'manifest' ? accepted.length : accepted.reduce((total, event) => total + event.sampleCount, 0)
      for (const [index, event] of accepted.entries()) {
        this.checkpoint(info, project)
        const capture = manifest.source.captures.find(c => c.start <= event.sampleStart && c.end >= event.sampleStart + event.sampleCount)!
        const recipe = manifest.mode === 'channelized' ? channelRecipe(event.freqLowerEdge, event.freqUpperEdge, info.sampleRate, event.sampleStart) : null
        const record: DatasetEvent = { event, capture, split: 'unassigned', groupId: `sha256:${manifest.source.sha256}`,
          sourceMapping: { startSample: event.sampleStart, sampleStep: 1, sampleCount: event.sampleCount }, recipe }
        if (manifest.mode !== 'manifest') {
          const name = `event-${String(index + 1).padStart(5, '0')}`
          const file = await fs.promises.open(path.join(staging, name + '.sigmf-data'), 'wx')
          const digest = createHash('sha256')
          try {
            for (let offset = 0; offset < event.sampleCount; offset += CHUNK) {
              this.checkpoint(info, project)
              const count = Math.min(CHUNK, event.sampleCount - offset), start = event.sampleStart + offset
              const context = recipe?.contextSamples ?? 0
              const first = Math.max(capture.start, start - context), last = Math.min(capture.end, start + count + context)
              const input = await this.readSamples(first, last - first)
              this.checkpoint(info, project)
              if (!(input instanceof Float32Array) || input.length !== (last - first) * 2 || input.some(value => !Number.isFinite(value))) {
                throw new Error('Invalid IQ samples returned during export')
              }
              const samples = recipe ? channelize(input, first, start, count, recipe) : input
              if (samples.some(value => !Number.isFinite(value))) throw new Error('Channelized IQ exceeds finite float32 range')
              const bytes = Buffer.allocUnsafe(samples.length * 4)
              for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], i * 4)
              digest.update(bytes)
              // FileHandle.write can short-write, so consume the complete buffer explicitly.
              let written = 0
              while (written < bytes.length) {
                const result = await file.write(bytes, written, bytes.length - written)
                if (!result.bytesWritten) throw new Error('Could not write IQ output')
                written += result.bytesWritten
              }
              job.completed += count
              await new Promise<void>(resolve => setImmediate(resolve))
            }
          } finally { await file.close() }
          record.iq = { path: name + '.sigmf-data', metadataPath: name + '.sigmf-meta', datatype: 'cf32_le',
            sampleRate: info.sampleRate, sampleCount: event.sampleCount, sha256: digest.digest('hex') }
          const metadata = { global: { 'core:datatype': 'cf32_le', 'core:sample_rate': info.sampleRate,
            'core:version': '1.2.5', 'core:dataset': record.iq.path,
            'core:description': `Snail accepted event ${event.id}. Source alignment and processing: manifest.json.` },
            captures: [{ 'core:sample_start': 0, 'core:frequency': capture.frequency + (recipe?.mixFrequencyHz ?? 0) }],
            annotations: [{ 'core:sample_start': 0, 'core:sample_count': event.sampleCount,
              'core:freq_lower_edge': capture.frequency + event.freqLowerEdge, 'core:freq_upper_edge': capture.frequency + event.freqUpperEdge,
              'core:label': event.label, 'core:comment': event.comment, 'core:uuid': event.id, 'core:generator': 'Snail' }] }
          await fs.promises.writeFile(path.join(staging, record.iq.metadataPath), JSON.stringify(metadata, null, 2), { flag: 'wx' })
        } else ++job.completed
        manifest.events.push(record)
      }
      await fs.promises.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
      await fs.promises.writeFile(path.join(staging, 'read_dataset.py'), PYTHON_READER, { flag: 'wx' })
      this.checkpoint(info, project)
      // Only a finished dataset gets its public folder name.
      await fs.promises.rename(staging, output)
      job.status = 'complete'; job.stage = 'complete'; job.outputPath = output
    } catch (error) {
      job.status = error instanceof Cancelled ? 'cancelled' : 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      try { if (createdStaging) await fs.promises.rm(staging, { recursive: true, force: true }) }
      catch (cleanupError) { job.error += `; could not remove partial output at ${staging}: ${String(cleanupError)}` }
    }
  }
}
