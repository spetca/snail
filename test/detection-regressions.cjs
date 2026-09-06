const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename)
const { SpectralDetector } = require('../src/main/detection/spectral-detector.ts')
const { EventProjects } = require('../src/main/detection/event-projects.ts')
const { RecordingSession } = require('../src/main/recording-session.ts')
const { saveAnnotationMetadata } = require('../src/main/annotation-metadata.ts')
const config = { fftSize: 128, thresholdDb: 12, minimumPowerDb: -110, minFrames: 3, minBins: 2, maxGapFrames: 1 }
function rows(count, active = () => true) {
  const data = new Float32Array(count * 128).fill(-100)
  for (let row = 0; row < count; row++) if (active(row)) data.fill(-40, row * 128 + 70, row * 128 + 74)
  return data
}
test('streaming detector joins tiles and one-frame gaps; clips scan boundary', () => {
  const events = [], detector = new SpectralDetector(config, 128000, 0, 640, e => events.push(e))
  detector.push(0, rows(5, r => r !== 4)); detector.push(320, rows(5)); detector.finish()
  assert.equal(events.length, 1)
  assert.deepEqual([events[0].sampleStart, events[0].sampleCount, events[0].freqLowerEdge, events[0].freqUpperEdge], [0, 640, 5500, 9500])
  assert.equal(events[0].frames, 9)
  assert.equal(events[0].touchesBoundary, true)
})
test('noise and short spikes do not become events; separated bursts stay separate', () => {
  const events = [], detector = new SpectralDetector(config, 128000, 0, 1280, e => events.push(e))
  detector.push(0, rows(20, r => r === 1 || (r >= 5 && r <= 7) || (r >= 12 && r <= 15))); detector.finish()
  assert.equal(events.length, 2)
  assert.deepEqual(events.map(e => e.sampleStart), [320, 768])
  assert.throws(() => new SpectralDetector({ ...config, fftSize: 129 }, 1, 0, 1, () => {}), /settings/)
  const bad = new SpectralDetector(config, 1, 0, 1000, () => {})
  assert.throws(() => bad.push(1, rows(1)), /Noncontiguous/)
  assert.throws(() => bad.push(0, new Float32Array(128).fill(NaN)), /Nonfinite/)
})
function fixture(t, reader) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-detect-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'capture.cf32'); fs.writeFileSync(file, Buffer.alloc(1280 * 8))
  const session = new RecordingSession()
  const info = session.open(() => ({ path: file, format: 'cf32', sampleRate: 128000, totalSamples: 1280, fileSize: 1280 * 8, centerFrequency: 100000000 }))
  const projects = new EventProjects(path.join(dir, 'projects'), session, reader ?? (async (start, n, stride, end) => rows(Math.min(256, Math.ceil((end - start) / stride)))))
  const request = { recordingId: info.recordingId, startSample: 0, endSample: 1280, config }
  return { dir, file, session, info, projects, request }
}
test('review persists revisions, deduplicates rescans, and writes only accepted RF annotations', async t => {
  const { dir, file, session, info, projects, request } = fixture(t)
  projects.start(request); await projects.settled()
  let project = projects.state(info.recordingId).project
  assert.equal(project.runs[0].status, 'complete'); assert.equal(project.proposals.length, 1)
  assert.equal(fs.existsSync(file + '.sigmf-meta'), false)
  const event = project.proposals[0]
  const review = (action, revision, patch) => projects.review({ recordingId: info.recordingId, proposalId: event.id, expectedRevision: revision, action, patch, frequencyMode: 'rf' })
  review('reject', 1); assert.equal(fs.existsSync(file + '.sigmf-meta'), false)
  review('restore', 2)
  assert.throws(() => review('accept', 1, event), /changed/)
  const patch = { ...event, sampleStart: 64, sampleCount: 512, label: 'test beacon', comment: 'reviewed bounds' }
  const accepted = review('accept', 3, patch)
  assert.equal(accepted.project.proposals[0].status, 'accepted')
  const meta = JSON.parse(accepted.sigmfMetaJson)
  assert.equal(meta.annotations[0]['core:freq_lower_edge'], 100005500)
  assert.equal(meta.annotations[0]['core:uuid'], event.id)
  projects.start(request); await projects.settled()
  project = projects.state(info.recordingId).project
  assert.equal(project.proposals.length, 1); assert.equal(project.proposals[0].sampleStart, 64)
  const restored = new EventProjects(path.join(dir, 'projects'), session, async () => rows(1)).state(info.recordingId).project
  assert.deepEqual(restored, project)
  assert.equal(restored.proposals[0].history.length, 4)
})
test('cancellation and recording switches discard pending FFT results', async t => {
  let resolve
  const f = fixture(t, () => new Promise(r => { resolve = r }))
  const state = f.projects.start(f.request)
  f.projects.cancel(f.info.recordingId, state.progress.id)
  resolve(rows(20)); await f.projects.settled()
  assert.equal(f.projects.state(f.info.recordingId).progress.status, 'cancelled')
  assert.equal(f.projects.state(f.info.recordingId).project.proposals.length, 0)
  f.projects.start(f.request)
  f.session.open(() => ({ ...f.info }))
  resolve(rows(20)); await f.projects.settled()
  assert.throws(() => f.projects.state(f.info.recordingId), /Recording changed/)
})
test('incomplete tiles report failure without claiming complete coverage', async t => {
  const f = fixture(t, async () => rows(1))
  f.projects.start(f.request); await f.projects.settled()
  const state = f.projects.state(f.info.recordingId)
  assert.equal(state.progress.status, 'failed'); assert.equal(state.progress.processedUntil, 0)
  assert.equal(state.project.proposals.length, 0)
})
test('capture retunes split candidates and constrain edits', async t => {
  const f = fixture(t)
  f.info.sigmfMetaJson = JSON.stringify({ global: { 'core:sample_rate': 128000 }, captures: [
    { 'core:sample_start': 0, 'core:frequency': 100000000 }, { 'core:sample_start': 640, 'core:frequency': 200000000 }
  ], annotations: [] })
  f.projects.start(f.request); await f.projects.settled()
  const events = f.projects.state(f.info.recordingId).project.proposals
  assert.equal(events.length, 2)
  assert.deepEqual(events.map(e => [e.sampleStart, e.sampleCount]), [[0, 640], [640, 640]])
  assert.throws(() => f.projects.review({ recordingId: f.info.recordingId, proposalId: events[0].id, expectedRevision: 1,
    action: 'edit', frequencyMode: 'rf', patch: { ...events[0], sampleCount: 1000 } }), /one capture/)
})
test('accept retry is idempotent even after legacy metadata migration', t => {
  const f = fixture(t)
  fs.writeFileSync(f.file + '.sigmf-meta', JSON.stringify({ global: {}, captures: [{ 'core:sample_start': 0, 'core:frequency': 100000000 }],
    annotations: [{ 'core:sample_start': 0, 'core:sample_count': 128, 'core:freq_lower_edge': 1000, 'core:freq_upper_edge': 2000 }] }))
  const annotation = { sampleStart: 128, sampleCount: 128, freqLowerEdge: 3000, freqUpperEdge: 4000, label: 'beacon', comment: '' }
  const first = saveAnnotationMetadata(f.info, annotation, 'legacy-baseband', 'retry-id')
  assert.equal(saveAnnotationMetadata(f.info, annotation, 'legacy-baseband', 'retry-id'), first)
  assert.equal(JSON.parse(first).annotations.length, 2)
  assert.throws(() => saveAnnotationMetadata(f.info, { ...annotation, label: 'changed' }, 'rf', 'retry-id'), /different content/)
})

test('partial-file load windows cannot produce annotations at incorrect source offsets', t => {
  const f = fixture(t); f.info.fileTotal = 2560
  assert.throws(() => f.projects.start(f.request), /full recording/)
})

test('failed metadata writes leave proposals pending and missing frequency bounds are rejected', async t => {
  const f = fixture(t); f.projects.start(f.request); await f.projects.settled()
  const event = f.projects.state(f.info.recordingId).project.proposals[0]
  const request = { recordingId: f.info.recordingId, proposalId: event.id, expectedRevision: 1,
    action: 'accept', frequencyMode: 'rf', patch: { ...event, label: 'beacon' } }
  assert.throws(() => f.projects.review({ ...request, patch: { ...request.patch, freqLowerEdge: undefined, freqUpperEdge: undefined } }), /both frequency/)
  fs.writeFileSync(f.file + '.sigmf-meta', '{broken')
  assert.throws(() => f.projects.review(request))
  assert.equal(f.projects.state(f.info.recordingId).project.proposals[0].status, 'proposed')
  assert.equal(fs.readFileSync(f.file + '.sigmf-meta', 'utf8'), '{broken')
})

test('pulse-width and bandwidth filters are inclusive and reject out-of-range candidates', () => {
  const collect = filters => {
    const events = [], detector = new SpectralDetector({ ...config, ...filters }, 128000, 0, 640, e => events.push(e))
    detector.push(0, rows(10)); detector.finish(); return events
  }
  assert.equal(collect({ minPulseWidthSeconds: 0.005, maxPulseWidthSeconds: 0.005, minBandwidthHz: 4000, maxBandwidthHz: 4000 }).length, 1)
  for (const filters of [{ minPulseWidthSeconds: 0.006 }, { maxPulseWidthSeconds: 0.004 }, { minBandwidthHz: 4001 }, { maxBandwidthHz: 3999 }]) {
    assert.equal(collect(filters).length, 0)
  }
  for (const filters of [{ minPulseWidthSeconds: -1 }, { maxBandwidthHz: NaN }, { minBandwidthHz: 4, maxBandwidthHz: 3 }, { maxPulseWidthSeconds: 0 }]) {
    assert.throws(() => collect(filters), /Invalid .* range/)
  }
})

test('queue reset archives reviews, preserves accepted metadata, clears scan history, and permits rescanning', async t => {
  const f = fixture(t); f.projects.start(f.request); await f.projects.settled()
  const event = f.projects.state(f.info.recordingId).project.proposals[0]
  f.projects.review({ recordingId: f.info.recordingId, proposalId: event.id, expectedRevision: 1,
    action: 'accept', frequencyMode: 'rf', patch: { ...event, label: 'beacon' } })
  const previous = f.projects.state(f.info.recordingId).project
  const metadata = fs.readFileSync(f.file + '.sigmf-meta', 'utf8')
  assert.throws(() => f.projects.reset(f.info.recordingId, previous.revision-1), /changed/)
  const reset = f.projects.reset(f.info.recordingId, previous.revision)
  assert.equal(reset.project.proposals.length, 0); assert.equal(reset.project.runs.length, 0)
  assert.equal(reset.progress, null); assert.ok(reset.project.revision > previous.revision)
  assert.equal(fs.readFileSync(f.file + '.sigmf-meta', 'utf8'), metadata)
  const archives = path.join(f.dir, 'projects', 'archive')
  const archived = JSON.parse(fs.readFileSync(path.join(archives, fs.readdirSync(archives)[0], previous.sourceKey + '.json'), 'utf8'))
  assert.deepEqual(archived, previous)
  f.projects.start(f.request); await f.projects.settled()
  assert.equal(f.projects.state(f.info.recordingId).project.proposals.length, 1)
})

test('reset cannot race a running scan', async t => {
  let resolve
  const f = fixture(t, () => new Promise(r => { resolve = r }))
  const state = f.projects.start(f.request)
  assert.throws(() => f.projects.reset(f.info.recordingId, state.project.revision), /cancel the scan/)
  f.projects.cancel(f.info.recordingId, state.progress.id); resolve(rows(20)); await f.projects.settled()
})

test('current-view frequency ROI excludes offscreen activity and estimates noise within the visible band', () => {
  const input = rows(10)
  // Bright out-of-view activity covers most of the full FFT; the visible band remains quiet except for the burst.
  for (let frame = 0; frame < 10; frame++) {
    input.fill(-10, frame*128, frame*128+64)
    input.fill(-10, frame*128+90, frame*128+128)
  }
  const events = []
  const detector = new SpectralDetector(config, 128000, 10000, 10640, event => events.push(event), { low: 4000, high: 16000 })
  detector.push(10000, input); detector.finish()
  assert.equal(events.length, 1)
  assert.equal(events[0].sampleStart, 10000)
  assert.equal(events[0].freqLowerEdge, 5500); assert.equal(events[0].freqUpperEdge, 9500)
  const outside = []
  const other = new SpectralDetector(config, 128000, 0, 640, event => outside.push(event), { low: -20000, high: -10000 })
  other.push(0, rows(10)); other.finish()
  assert.equal(outside.length, 0)
  assert.throws(() => new SpectralDetector(config, 128000, 0, 640, () => {}, { low: 100, high: 200 }), /no detector bins/)
})

test('scan stores the visible frequency range and clips candidate frequency bounds to it', async t => {
  const f = fixture(t)
  f.projects.start({ ...f.request, frequencyRange: { low: 6000, high: 10000 } }); await f.projects.settled()
  // The selected region is densely occupied, so disable relative threshold interference with a wider ROI for emitted bounds check.
  const run = f.projects.state(f.info.recordingId).project.runs[0]
  assert.deepEqual(run.frequencyRange, { low: 6000, high: 10000 })
  const events = [], detector = new SpectralDetector({ ...config, minBins: 1 }, 128000, 0, 640, event => events.push(event), { low: 6000, high: 30000 })
  detector.push(0, rows(10)); detector.finish()
  assert.equal(events.length, 1); assert.equal(events[0].freqLowerEdge, 6000)
})

test('absolute power detects bright broad signals even when they raise the median noise estimate', () => {
  const data = new Float32Array(10*128).fill(-100)
  for (let row = 0; row < 10; row++) {
    data.fill(-30, row*128+10, row*128+100)
    data.fill(-70, row*128+110, row*128+114)
  }
  const collect = mode => {
    const events = [], detector = new SpectralDetector({ ...config, thresholdMode: mode, minimumPowerDb: -50 }, 128000, 0, 640, e => events.push(e))
    detector.push(0, data); detector.finish(); return events
  }
  assert.equal(collect('relative').length, 0, 'Dense activity can contaminate a median estimate')
  const events = collect('absolute')
  assert.equal(events.length, 1, 'Fixed power should retain the bright band and exclude the weak one')
  assert.equal(events[0].freqLowerEdge, -54500)
  assert.equal(events[0].freqUpperEdge, 35500)
})

test('absolute threshold has bounded hysteresis and rejects invalid modes', () => {
  const events = [], detector = new SpectralDetector({ ...config, thresholdMode: 'absolute', minimumPowerDb: -50 }, 128000, 0, 640, e => events.push(e))
  const data = rows(10)
  // Weak-only regions cannot start in the hysteresis band.
  for (let row = 0; row < 10; row++) data.fill(-52, row*128+80, row*128+84)
  detector.push(0, data); detector.finish()
  assert.equal(events.length, 1)
  assert.throws(() => new SpectralDetector({ ...config, thresholdMode: 'unknown' }, 128000, 0, 640, () => {}), /Invalid detector/)
})
