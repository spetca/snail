import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { metadataPaths, saveAnnotationMetadata } from '../annotation-metadata'
import type { RecordingSession } from '../recording-session'
import type { FileInfo } from '../../shared/sample-formats'
import { captureSegments, annotationRecords } from '../../shared/sigmf'
import { DETECTOR_VERSION, type EventProject, type EventProposal, type EventBounds, type DetectionRun,
  type DetectionState, type StartDetectionRequest, type ReviewProposalRequest, type ReviewProposalResult } from '../../shared/detection'
import { SpectralDetector, validateDetectionConfig, detectionBins } from './spectral-detector'

const MAX_PROPOSALS = 2000
const MAX_PROJECT_BYTES = 32 * 1024 * 1024
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const bounds = (event: EventBounds): EventBounds => ({ sampleStart: event.sampleStart, sampleCount: event.sampleCount,
  freqLowerEdge: event.freqLowerEdge, freqUpperEdge: event.freqUpperEdge })
class QueueLimit extends Error {}
interface ActiveRun { recordingId: string; project: EventProject; run: DetectionRun; cancelled: boolean }
type TileReader = (start: number, fftSize: number, stride: number, end: number) => Promise<Float32Array>

/** Local, revisioned review projects. Raw IQ is never modified. */
export class EventProjects {
  private cached: EventProject | null = null
  private active: ActiveRun | null = null
  private task: Promise<void> = Promise.resolve()

  constructor(private directory: string, private session: RecordingSession, private readTile: TileReader) {}

  private source(info: FileInfo) {
    if (info.fileTotal != null && info.fileTotal !== info.totalSamples) {
      throw new Error('Detection requires the full recording to be opened. Reopen without a load window, then choose a cursor or viewport scan range.')
    }
    const dataPath = fs.realpathSync(metadataPaths(info.path).data)
    const stat = fs.statSync(dataPath)
    const source = { path: dataPath, size: stat.size, modifiedMs: stat.mtimeMs,
      totalSamples: info.totalSamples, sampleRate: info.sampleRate, format: info.format }
    return { source, key: hash({ ...source, captures: captureSegments(info) }) }
  }

  private save(project: EventProject, directory = this.directory): void {
    const text = JSON.stringify(project)
    if (Buffer.byteLength(text) > MAX_PROJECT_BYTES) throw new Error('Review project exceeds the 32 MB limit')
    fs.mkdirSync(directory, { recursive: true })
    const destination = path.join(directory, project.sourceKey + '.json')
    const temp = destination + '.' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, text, { flag: 'wx' }); fs.renameSync(temp, destination) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }

  private project(info: FileInfo): EventProject {
    const { key, source } = this.source(info)
    if (this.cached?.sourceKey === key) return this.cached
    const filename = path.join(this.directory, key + '.json')
    let project: EventProject
    if (fs.existsSync(filename)) {
      if (fs.statSync(filename).size > MAX_PROJECT_BYTES) throw new Error('Review project is too large')
      project = JSON.parse(fs.readFileSync(filename, 'utf8'))
      if (project.schemaVersion !== 1 || project.sourceKey !== key || !Number.isSafeInteger(project.revision) ||
          !Array.isArray(project.proposals) || !Array.isArray(project.runs) || project.proposals.length > MAX_PROPOSALS || project.runs.length > 100) {
        throw new Error('Unsupported or malformed review project; the saved file has been left untouched')
      }
      const validBounds = (event: EventBounds) => {
        try { return Number.isFinite(event.freqLowerEdge) && Number.isFinite(event.freqUpperEdge) && annotationRecords(event, info).length === 1 }
        catch { return false }
      }
      if (project.proposals.some(event => !event || typeof event.id !== 'string' || typeof event.fingerprint !== 'string' ||
          !Number.isSafeInteger(event.revision) || event.revision < 1 || typeof event.label !== 'string' || typeof event.comment !== 'string' ||
          !['proposed', 'accepted', 'rejected'].includes(event.status) || !Number.isFinite(event.peakAboveNoiseDb) || !validBounds(event) ||
          !Array.isArray(event.history) || event.history.some(revision => !revision || !Number.isSafeInteger(revision.revision) ||
            typeof revision.at !== 'string' || typeof revision.action !== 'string' || typeof revision.label !== 'string')) ||
          project.runs.some(run => !run || typeof run.id !== 'string' || !['running','complete','failed','cancelled','limited'].includes(run.status) ||
            !Number.isSafeInteger(run.startSample) || !Number.isSafeInteger(run.endSample) || run.endSample <= run.startSample ||
            !Number.isFinite(run.processedUntil))) {
        throw new Error('Malformed review project; the saved file has been left untouched')
      }
      project.source = source
      for (const run of project.runs) if (run.status === 'running' && this.active?.run.id !== run.id) {
        run.status = 'cancelled'; run.error = 'Interrupted before completion. Rescan to complete coverage.'
        run.finishedAt = new Date().toISOString(); ++project.revision
      }
    } else {
      project = { schemaVersion: 1, sourceKey: key, source, revision: 0, proposals: [], runs: [] }
    }
    this.cached = project
    return project
  }

  state(recordingId: string, knownRevision?: number): DetectionState {
    const info = this.session.assertCurrent(recordingId)
    const project = this.project(info)
    return clone({ recordingId, ...(knownRevision === project.revision ? {} : { project }),
      progress: this.active?.recordingId === recordingId ? this.active.run : project.runs.at(-1) ?? null })
  }

  start(request: StartDetectionRequest): DetectionState {
    const info = this.session.assertCurrent(request.recordingId)
    validateDetectionConfig(request.config)
    detectionBins(request.config.fftSize, info.sampleRate, request.frequencyRange)
    if (!Number.isSafeInteger(request.startSample) || !Number.isSafeInteger(request.endSample) ||
        request.startSample < 0 || request.endSample <= request.startSample || request.endSample > info.totalSamples) {
      throw new Error('Choose a nonempty detection range inside the recording')
    }
    if (this.active) throw new Error('A scan is already running. Cancel it or wait for it to finish.')
    const previous = this.project(info)
    if (previous.proposals.length >= MAX_PROPOSALS) throw new Error('Review queue limit reached (2000 proposals)')
    if (previous.runs.length >= 100) throw new Error('Project scan history limit reached (100 runs)')
    const run: DetectionRun = { id: randomUUID(), detectorVersion: DETECTOR_VERSION, config: { ...request.config },
      startSample: request.startSample, endSample: request.endSample, sampleRate: info.sampleRate,
      ...(request.frequencyRange ? { frequencyRange: { ...request.frequencyRange } } : {}),
      startedAt: new Date().toISOString(), status: 'running', processedUntil: request.startSample, candidateCount: 0 }
    const project = { ...previous, proposals: [...previous.proposals], runs: [...previous.runs, run], revision: previous.revision + 1 }
    this.save(project)
    this.cached = project
    this.active = { recordingId: info.recordingId, project, run, cancelled: false }
    this.task = this.scan(info, this.active)
    return this.state(info.recordingId)
  }

  reset(recordingId: string, expectedRevision: number): DetectionState {
    const info = this.session.assertCurrent(recordingId)
    if (this.active) throw new Error('Finish or cancel the scan before resetting the review queue')
    const previous = this.project(info)
    if (previous.revision !== expectedRevision) throw new Error('Review project changed; reload the queue before resetting')
    // Archive before replacing the active project; accepted SigMF annotations remain untouched.
    this.save(previous, path.join(this.directory, 'archive', randomUUID()))
    const next: EventProject = { ...previous, revision: previous.revision + 1, proposals: [], runs: [] }
    this.save(next)
    this.cached = next
    return this.state(recordingId)
  }

  cancel(recordingId: string, runId: string): void {
    this.session.assertCurrent(recordingId)
    if (this.active?.recordingId === recordingId && this.active.run.id === runId) this.active.cancelled = true
  }

  /** Useful to orderly shutdowns and deterministic integration tests. */
  settled(): Promise<void> { return this.task }

  private async scan(info: FileInfo, active: ActiveRun): Promise<void> {
    const { project, run } = active
    const stillCurrent = () => !active.cancelled && this.session.isCurrent(info.recordingId)
    const fingerprints = new Set(project.proposals.map(proposal => proposal.fingerprint))
    let checkpointAt = Date.now()
    try {
      const segments = captureSegments(info).filter(segment => segment.end > run.startSample && segment.start < run.endSample)
      for (const segment of segments) {
        const start = Math.max(segment.start, run.startSample), end = Math.min(segment.end, run.endSample)
        const detector = new SpectralDetector(run.config, info.sampleRate, start, end, event => {
          ++run.candidateCount
          const fingerprint = hash([project.sourceKey, DETECTOR_VERSION, run.config, bounds(event)])
          if (fingerprints.has(fingerprint)) return // Keep edited/accepted/rejected decisions on identical rescans.
          if (project.proposals.length >= MAX_PROPOSALS) throw new QueueLimit('Stopped at the 2000-proposal limit; coverage is incomplete')
          const proposal: EventProposal = { ...event, id: randomUUID(), fingerprint, runId: run.id, revision: 1,
            status: 'proposed', label: '', comment: '', history: [] }
          proposal.history.push({ revision: 1, at: new Date().toISOString(), action: 'propose', status: 'proposed',
            label: '', comment: '', bounds: bounds(event) })
          project.proposals.push(proposal); fingerprints.add(fingerprint); ++project.revision
        }, run.frequencyRange)
        for (let position = start; position < end; position += 256 * detector.stride) {
          if (!stillCurrent()) break
          const stat = fs.statSync(project.source.path)
          if (stat.size !== project.source.size || stat.mtimeMs !== project.source.modifiedMs) throw new Error('Recording changed on disk; reopen it before scanning')
          const data = await this.readTile(position, run.config.fftSize, detector.stride, end)
          if (!stillCurrent()) break
          if (!(data instanceof Float32Array) || data.length === 0) throw new Error('No FFT data returned; coverage is incomplete')
          const expectedRows = Math.min(256, Math.ceil((end - position) / detector.stride))
          if (data.length !== expectedRows * run.config.fftSize) throw new Error('Incomplete FFT tile; scan stopped without claiming complete coverage')
          detector.push(position, data)
          run.processedUntil = Math.min(end, position + expectedRows * detector.stride)
          if (Date.now() - checkpointAt > 2000) { this.save(project); checkpointAt = Date.now() }
          await new Promise<void>(resolve => setImmediate(resolve))
        }
        if (!stillCurrent()) break
        detector.finish()
      }
      run.status = stillCurrent() ? 'complete' : 'cancelled'
    } catch (error) {
      run.status = error instanceof QueueLimit ? 'limited' : 'failed'
      run.error = error instanceof Error ? error.message : String(error)
    } finally {
      run.finishedAt = new Date().toISOString(); ++project.revision
      try { this.save(project) }
      catch (error) { run.status = 'failed'; run.error = `Could not save review project: ${String(error)}` }
      if (this.active === active) this.active = null
    }
  }

  review(request: ReviewProposalRequest): ReviewProposalResult {
    const info = this.session.assertCurrent(request.recordingId)
    if (this.active) throw new Error('Finish or cancel the scan before reviewing proposals')
    const project = this.project(info)
    const original = project.proposals.find(proposal => proposal.id === request.proposalId)
    if (!original || original.revision !== request.expectedRevision) throw new Error('Proposal changed; reload the review queue')
    if (original.status === 'accepted') throw new Error('This proposal has already been accepted; its annotation is preserved')
    if (!['edit', 'accept', 'reject', 'restore'].includes(request.action)) throw new Error('Invalid review action')
    if (request.frequencyMode !== 'rf' && request.frequencyMode !== 'legacy-baseband') throw new Error('Invalid annotation frequency mode')
    const proposal = clone(original)
    if (request.action === 'edit' || request.action === 'accept') {
      if (original.status !== 'proposed') throw new Error('Restore a rejected proposal before editing it')
      if (!request.patch || typeof request.patch.label !== 'string' || typeof request.patch.comment !== 'string') throw new Error('Missing proposal edits')
      const patch = { ...bounds(request.patch), label: request.patch.label.trim(), comment: request.patch.comment.trim() }
      if (!Number.isFinite(patch.freqLowerEdge) || !Number.isFinite(patch.freqUpperEdge)) throw new Error('Proposal requires both frequency bounds')
      if (patch.label.length > 128 || patch.comment.length > 2000) throw new Error('Label or comment is too long')
      if (annotationRecords(patch, info).length !== 1) throw new Error('Keep an event inside one capture segment')
      Object.assign(proposal, patch)
    }
    let sigmfMetaJson: string | undefined
    if (request.action === 'accept') {
      if (!proposal.label) throw new Error('Give the event a label before accepting it')
      const comment = [proposal.comment, `Reviewed Snail proposal ${proposal.id}; run ${proposal.runId}; ${DETECTOR_VERSION}; peak ${proposal.peakAboveNoiseDb.toFixed(1)} dB above median spectral noise.`].filter(Boolean).join('\n')
      sigmfMetaJson = saveAnnotationMetadata(info, { ...bounds(proposal), label: proposal.label, comment }, request.frequencyMode, proposal.id)
      proposal.status = 'accepted'
    } else if (request.action === 'reject') proposal.status = 'rejected'
    else if (request.action === 'restore') {
      if (original.status !== 'rejected') throw new Error('Only rejected proposals can be restored')
      proposal.status = 'proposed'
    }
    ++proposal.revision
    proposal.history.push({ revision: proposal.revision, at: new Date().toISOString(), action: request.action,
      status: proposal.status, label: proposal.label, comment: proposal.comment, bounds: bounds(proposal) })
    const next = { ...project, revision: project.revision + 1,
      proposals: project.proposals.map(event => event.id === proposal.id ? proposal : event) }
    this.save(next) // Acceptance is idempotent by annotation UUID if this second write fails.
    this.cached = next
    return { project: clone(next), sigmfMetaJson }
  }
}
