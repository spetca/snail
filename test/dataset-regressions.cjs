const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename)
const { DatasetExporter } = require('../src/main/dataset/exporter.ts')
const { channelRecipe, channelize } = require('../src/main/dataset/channelizer.ts')
const { RecordingSession } = require('../src/main/recording-session.ts')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fixture(t, reader) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-dataset-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const source = path.join(dir, 'source.cf32'), data = new Float32Array(12000 * 2)
  for (let i = 0; i < 12000; i++) { data[2*i] = Math.cos(2*Math.PI*i/8); data[2*i+1] = Math.sin(2*Math.PI*i/8) }
  const bytes = Buffer.alloc(data.length * 4)
  for (let i = 0; i < data.length; i++) bytes.writeFloatLE(data[i], i*4)
  fs.writeFileSync(source, bytes)
  const stat = fs.statSync(source), session = new RecordingSession()
  const info = session.open(() => ({ path: source, totalSamples: 12000, fileSize: stat.size, format: 'cf32', sampleRate: 8000, centerFrequency: 100000000 }))
  const event = { id: 'accepted-1', fingerprint: 'fp', runId: 'run-1', revision: 2, status: 'accepted', label: 'beacon', comment: 'analyst checked',
    sampleStart: 2000, sampleCount: 5000, freqLowerEdge: 500, freqUpperEdge: 1500, peakAboveNoiseDb: 20, frames: 10, touchesBoundary: false,
    history: [{ revision: 2, at: '2026-09-05', action: 'accept', status: 'accepted', label: 'beacon', comment: '', bounds: {} }] }
  const project = { schemaVersion: 1, revision: 2, sourceKey: 'key', source: { path: fs.realpathSync(source), size: stat.size, modifiedMs: stat.mtimeMs, totalSamples: 12000, sampleRate: 8000, format: 'cf32' },
    proposals: [event, { ...event, id: 'proposed', status: 'proposed' }, { ...event, id: 'rejected', status: 'rejected' }], runs: [] }
  const exporter = new DatasetExporter(session, reader ?? ((start, count) => data.slice(start*2, (start+count)*2)))
  return { dir, info, project, exporter, data, bytes, session, source }
}
async function run(f, mode) {
  f.exporter.start(f.info.recordingId, f.project, mode, f.dir); await f.exporter.settled()
  const job = f.exporter.state(f.info.recordingId)
  assert.equal(job.status, 'complete', job.error)
  return { job, manifest: JSON.parse(fs.readFileSync(path.join(job.outputPath, 'manifest.json'), 'utf8')) }
}

test('manifest exports only accepted revisions with full-source checksum and unassigned recording group', async t => {
  const f = fixture(t), { job, manifest } = await run(f, 'manifest')
  assert.equal(manifest.events.length, 1)
  assert.deepEqual(manifest.events[0].event, f.project.proposals[0])
  assert.equal(manifest.source.sha256, sha(f.bytes))
  assert.equal(manifest.events[0].groupId, 'sha256:' + sha(f.bytes))
  assert.equal(manifest.events[0].split, 'unassigned')
  assert.equal(manifest.events[0].iq, undefined)
  assert.deepEqual(manifest.events[0].sourceMapping, { startSample: 2000, sampleStep: 1, sampleCount: 5000 })
  assert.deepEqual(fs.readdirSync(job.outputPath).sort(), ['manifest.json', 'read_dataset.py'])
  const { spawnSync } = require('node:child_process')
  const python = spawnSync('python3', [path.join(job.outputPath, 'read_dataset.py'), job.outputPath], { encoding: 'utf8' })
  if (!python.error) { assert.equal(python.status, 0, python.stderr); assert.match(python.stdout, /beacon 5000 unassigned/) }
})

test('unfiltered IQ crops are byte-exact, reproducible, and existing output is preserved', async t => {
  const f = fixture(t), first = await run(f, 'iq'), second = await run(f, 'iq')
  assert.notEqual(first.job.outputPath, second.job.outputPath)
  assert.deepEqual(first.manifest.events, second.manifest.events)
  const artifact = first.manifest.events[0].iq, actual = fs.readFileSync(path.join(first.job.outputPath, artifact.path))
  assert.deepEqual(actual, f.bytes.subarray(2000*8, 7000*8))
  assert.equal(artifact.sha256, sha(actual))
  const meta = JSON.parse(fs.readFileSync(path.join(first.job.outputPath, artifact.metadataPath), 'utf8'))
  assert.equal(meta.captures[0]['core:frequency'], 100000000)
  assert.equal(meta.annotations[0]['core:sample_start'], 0)
  assert.equal(meta.annotations[0]['core:freq_lower_edge'], 100000500)
  assert.equal(meta.annotations[0]['core:uuid'], 'accepted-1')
})

test('channelized IQ tunes to DC and retains time alignment, sample count, and RF annotation coordinates', async t => {
  const f = fixture(t), { job, manifest } = await run(f, 'channelized')
  const record = manifest.events[0], output = fs.readFileSync(path.join(job.outputPath, record.iq.path))
  assert.equal(output.length, 5000*8)
  for (let n = 0; n < 5000; n++) {
    assert.ok(Math.abs(output.readFloatLE(n*8) - 1) < 1e-6)
    assert.ok(Math.abs(output.readFloatLE(n*8+4)) < 1e-6)
  }
  assert.equal(record.recipe.mixFrequencyHz, 1000)
  assert.equal(record.recipe.decimation, 1)
  const meta = JSON.parse(fs.readFileSync(path.join(job.outputPath, record.iq.metadataPath), 'utf8'))
  assert.equal(meta.captures[0]['core:frequency'], 100001000)
  assert.equal(meta.annotations[0]['core:freq_lower_edge'], 100000500)
})

test('centered FIR rejects an out-of-band tone and has no impulse delay across chunk boundaries', () => {
  const recipe = channelRecipe(-500, 500, 8000, 0), data = new Float32Array(10000*2)
  for (let n = 0; n < 10000; n++) { data[2*n] = Math.cos(2*Math.PI*2000*n/8000); data[2*n+1] = Math.sin(2*Math.PI*2000*n/8000) }
  const output = channelize(data, 0, 2000, 1000, recipe)
  const rms = Math.sqrt(output.reduce((sum, x) => sum + x*x, 0) / 1000)
  assert.ok(rms < 0.001, 'Out-of-band tone must be attenuated by at least 60 dB in this fixture')
  data.fill(0); data[4096*2] = 1
  const whole = channelize(data, 0, 3000, 3000, recipe)
  const left = channelize(data, 0, 3000, 1096, recipe), right = channelize(data, 0, 4096, 1904, recipe)
  assert.deepEqual(whole, Float32Array.from([...left, ...right]))
  let max = 0
  for (let n = 0; n < whole.length/2; n++) if (whole[2*n] > whole[2*max]) max = n
  assert.equal(max + 3000, 4096)
  assert.throws(() => channelRecipe(-4000, 4000, 8000, 0), /Full-band/)
  assert.throws(() => channelRecipe(0, 1e-20, 8000, 0), /too narrow/)
})

test('cancellation discards a pending sample read and removes incomplete output', async t => {
  let resolve, entered
  const started = new Promise(r => { entered = r })
  const f = fixture(t, () => { entered(); return new Promise(r => { resolve = r }) })
  const job = f.exporter.start(f.info.recordingId, f.project, 'iq', f.dir)
  await started
  f.exporter.cancel(f.info.recordingId, job.id)
  resolve(new Float32Array(4096)); await f.exporter.settled()
  assert.equal(f.exporter.state(f.info.recordingId).status, 'cancelled')
  assert.deepEqual(fs.readdirSync(f.dir), ['source.cf32'])
})

test('a source switch cannot publish old work or export samples from the new recording', async t => {
  let resolve, entered
  const started = new Promise(r => { entered = r })
  const f = fixture(t, () => { entered(); return new Promise(r => { resolve = r }) })
  f.exporter.start(f.info.recordingId, f.project, 'iq', f.dir); await started
  const next = f.session.open(() => ({ ...f.info }))
  resolve(new Float32Array(4096)); await f.exporter.settled()
  assert.equal(f.exporter.state(next.recordingId), null)
  assert.deepEqual(fs.readdirSync(f.dir), ['source.cf32'])
})

test('export rejects changed sources, unsupported modes, and unaccepted queues before writing', t => {
  const f = fixture(t)
  assert.throws(() => f.exporter.start(f.info.recordingId, f.project, 'unknown', f.dir), /mode/)
  assert.throws(() => f.exporter.start(f.info.recordingId, { ...f.project, proposals: [] }, 'iq', f.dir), /Accept/)
  fs.appendFileSync(f.source, 'changed')
  assert.throws(() => f.exporter.start(f.info.recordingId, f.project, 'iq', f.dir), /changed/)
  assert.deepEqual(fs.readdirSync(f.dir), ['source.cf32'])
})

test('channel context stops at capture boundaries and does not leak a neighboring transmission', async t => {
  const reads = [], f = fixture(t)
  f.info.sigmfMetaJson = JSON.stringify({ global: {}, captures: [ { 'core:sample_start': 0, 'core:frequency': 100000000 },
    { 'core:sample_start': 6000, 'core:frequency': 200000000 } ], annotations: [] })
  f.project.proposals[0].sampleStart = 6000; f.project.proposals[0].sampleCount = 4000
  f.data.fill(0, 6000*2)
  f.exporter = new DatasetExporter(f.session, (start, count) => { reads.push([start,count]); return f.data.slice(start*2,(start+count)*2) })
  const { job, manifest } = await run(f, 'channelized')
  assert.ok(reads.every(([start,count]) => start >= 6000 && start+count <= 12000))
  const output = fs.readFileSync(path.join(job.outputPath, manifest.events[0].iq.path))
  assert.ok(output.every(byte => byte === 0))
  assert.equal(manifest.events[0].capture.frequency, 200000000)
})

test('bundled Python reader loads complex IQ, maps samples, and detects checksum tampering', async t => {
  const { spawnSync } = require('node:child_process')
  const available = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' })
  if (available.status !== 0) { t.skip('Python with NumPy is required for reader integration'); return }
  const f = fixture(t), { job } = await run(f, 'iq')
  const code = `
import sys
sys.path.insert(0, sys.argv[1])
from read_dataset import Dataset
import numpy as np
from pathlib import Path
p = Path(sys.argv[1])
d = Dataset(p)
a = d.read_iq(0)
assert a.dtype == np.dtype('<c8') and a.shape == (5000,)
np.testing.assert_allclose(a, np.exp(2j*np.pi*np.arange(2000,7000)/8), atol=1e-6)
assert d.source_sample(0, 0) == 2000 and d.source_sample(0, 4999) == 6999
assert d.group_id(0).startswith('sha256:')
with (p / d.events[0]['iq']['path']).open('r+b') as stream:
    stream.write(b'\\x01')
try:
    d.read_iq(0)
    raise AssertionError('Expected checksum mismatch')
except ValueError as error:
    assert 'checksum' in str(error)
`
  const result = spawnSync('python3', ['-c', code, job.outputPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('malformed native sample responses fail without leaving a published dataset', async t => {
  const f = fixture(t, () => new Float32Array(2))
  f.exporter.start(f.info.recordingId, f.project, 'iq', f.dir); await f.exporter.settled()
  const job = f.exporter.state(f.info.recordingId)
  assert.equal(job.status, 'failed'); assert.match(job.error, /Invalid IQ/)
  assert.equal(job.outputPath, undefined)
  assert.deepEqual(fs.readdirSync(f.dir), ['source.cf32'])
})
