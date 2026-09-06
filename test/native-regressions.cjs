const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const native = require('../src/native/build/Release/snail_native.node')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-native-'))
const aPath = path.join(dir, 'a.cf32'), bPath = path.join(dir, 'b.cf32')
const count = (1 << 20) + 8192
const data = new Float32Array(count * 2)
for (let i = 0; i < count; ++i) data[i * 2] = 1
fs.writeFileSync(aPath, Buffer.from(data.buffer))
fs.writeFileSync(bPath, Buffer.alloc(2048 * 8))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
const config = { startSample: 0, length: 8192, fftSize: 8192, window: 'none', shift: false, scale: 'abs' }

test('queued FFT, spectrogram, and correlation work retains A while B opens', async () => {
  native.openFile(aPath)
  const expectedFFT = await native.computeFFT(config)
  const expectedTile = await native.computeFFTTile(0, 512, 512)
  const corr = { mode: 'self', windowStart: 0, windowLength: 8192, tu: 32, cpLen: 16 }
  const expectedCorr = await native.correlate(corr)
  const pending = []
  for (let i = 0; i < 8; i++) {
    pending.push(native.computeFFT(config).then(result => assert.deepEqual(result.data, expectedFFT.data)))
    pending.push(native.computeFFTTile(0, 512, 512).then(result => assert.deepEqual(result, expectedTile)))
    pending.push(native.correlate(corr).then(result => assert.deepEqual(result, expectedCorr)))
  }
  native.openFile(bPath)
  assert.deepEqual(Array.from(native.getSamples(0, 4)), Array(8).fill(0))
  await Promise.all(pending)
})

test('failed file open leaves the previous mapping usable', () => {
  native.openFile(aPath)
  assert.throws(() => native.openFile(path.join(dir, 'missing.cf32')), /Failed to open/)
  assert.deepEqual(Array.from(native.getSamples(0, 2)), [1, 0, 1, 0])
})

test('oversized FFT selection respects the allocation cap', async () => {
  native.openFile(aPath)
  const result = await native.computeFFT({ ...config, length: count })
  assert.equal(result.data.length, 1 << 20)
  assert.ok(Number.isFinite(result.maxPower) && result.maxPower > 0)
  assert.ok(result.data[0] > result.data[1])
})

test('filtered export records the tuned RF center and rejects empty frequency bounds', () => {
  native.openFile(aPath)
  const request = { outputPath: path.join(dir, 'filtered'), startSample: 0, endSample: 1024,
    sampleRate: 1000000, centerFrequency: 100000000, applyBandpass: true,
    bandpassLow: 10000, bandpassHigh: 30000 }
  assert.equal(native.exportSigMF(request).success, true)
  const metadata = JSON.parse(fs.readFileSync(request.outputPath + '.sigmf-meta', 'utf8'))
  assert.equal(metadata.captures[0]['core:frequency'], 100020000)
  assert.equal(metadata.annotations[0]['core:sample_start'], 0)
  assert.equal(metadata.annotations[0]['core:sample_count'], 1024)
  assert.equal(native.exportSigMF({ ...request, bandpassHigh: 10000 }).success, false)
  assert.equal(native.exportSigMF({ ...request, endSample: 0 }).success, false)
})

test('bounded spectrogram windows cannot read beyond a scan or retune boundary', async () => {
  native.openFile(aPath)
  const bounded = await native.computeFFTTile(0, 512, 256, 1000)
  const prefixPath = path.join(dir, 'prefix.cf32')
  fs.writeFileSync(prefixPath, Buffer.from(data.buffer, 0, 1000 * 8))
  native.openFile(prefixPath)
  const prefix = await native.computeFFTTile(0, 512, 256)
  assert.deepEqual(bounded, prefix)
  assert.equal(bounded.length, 4 * 512)
})

test('native FFT and streaming detector find a synthetic narrowband burst', async () => {
  const ts = require('typescript')
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename)
  const { SpectralDetector } = require('../src/main/detection/spectral-detector.ts')
  const { DEFAULT_DETECTION_CONFIG } = require('../src/shared/detection.ts')
  const samples = new Float32Array(65536 * 2)
  for (let i = 20000; i < 45000; i++) {
    samples[2*i] = Math.cos(2*Math.PI*i/16)
    samples[2*i+1] = Math.sin(2*Math.PI*i/16)
  }
  const file = path.join(dir, 'burst.cf32'); fs.writeFileSync(file, Buffer.from(samples.buffer))
  native.openFile(file)
  const events = [], detector = new SpectralDetector(DEFAULT_DETECTION_CONFIG, 1000000, 0, 65536, e => events.push(e))
  detector.push(0, await native.computeFFTTile(0, 512, 256, 65536)); detector.finish()
  assert.equal(events.length, 1)
  const event = events[0]
  assert.ok(Math.abs(event.sampleStart - 20000) <= 512)
  assert.ok(Math.abs(event.sampleStart + event.sampleCount - 45000) <= 512)
  assert.ok(event.freqLowerEdge <= 62500 && event.freqUpperEdge >= 62500)
})

test('dataset export using native samples reopens with tuned RF center and exact sample alignment', async () => {
  const { DatasetExporter } = require('../src/main/dataset/exporter.ts')
  const { RecordingSession } = require('../src/main/recording-session.ts')
  const samples = new Float32Array(12000*2)
  for (let n = 0; n < 12000; n++) { samples[2*n] = Math.cos(2*Math.PI*n/8); samples[2*n+1] = Math.sin(2*Math.PI*n/8) }
  const sourcePath = path.join(dir, 'dataset-source.cf32')
  fs.writeFileSync(sourcePath, Buffer.from(samples.buffer))
  const session = new RecordingSession()
  const info = session.open(() => ({ ...native.openFile(sourcePath), sampleRate: 8000, centerFrequency: 100000000 }))
  const stat = fs.statSync(sourcePath)
  const project = { schemaVersion: 1, sourceKey: 'native-fixture', revision: 2,
    source: { path: fs.realpathSync(sourcePath), size: stat.size, modifiedMs: stat.mtimeMs, totalSamples: 12000, sampleRate: 8000, format: 'cf32' }, runs: [],
    proposals: [{ id: 'native-event', status: 'accepted', revision: 2, label: 'test beacon', comment: '', sampleStart: 2000, sampleCount: 5000, freqLowerEdge: 500, freqUpperEdge: 1500, history: [] }] }
  const exporter = new DatasetExporter(session, (start,count) => native.getSamples(start,count,1))
  exporter.start(info.recordingId, project, 'channelized', dir); await exporter.settled()
  const job = exporter.state(info.recordingId)
  assert.equal(job.status, 'complete', job.error)
  const manifest = JSON.parse(fs.readFileSync(path.join(job.outputPath, 'manifest.json'), 'utf8'))
  const reopened = native.openFile(path.join(job.outputPath, manifest.events[0].iq.path))
  assert.equal(reopened.sampleRate, 8000)
  assert.equal(reopened.centerFrequency, 100001000)
  assert.equal(reopened.totalSamples, 5000)
  const actual = native.getSamples(0,5000,1)
  for (let n = 0; n < 5000; n++) { assert.ok(Math.abs(actual[2*n]-1)<1e-6); assert.ok(Math.abs(actual[2*n+1])<1e-6) }
})
