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

function classifierModel(frameSize = 256, label = 'test') {
  return { n_components: 1, frame_size: frameSize, pca_mean: Array(15).fill(0),
    pca_components: [Array(15).fill(0)], classes: [{ label, centroid: [0], inv_cov: [[1]] }] }
}

test('classification retains its source and model across file/model switches and uses model frame size', async () => {
  const model = path.join(dir, 'classifier.json')
  fs.writeFileSync(model, JSON.stringify(classifierModel(512, 'original')))
  assert.equal(native.loadClassifier(model).success, true)
  native.openFile(aPath)
  const pending = native.classifyRegion({ startSample: 0, sampleCount: 4096 })
  assert.equal(typeof pending.then, 'function', 'Classification must not block the Electron main thread')
  native.openFile(bPath)
  fs.writeFileSync(model, JSON.stringify(classifierModel(256, 'replacement')))
  native.loadClassifier(model)
  const result = await pending
  assert.equal(result.length, 8)
  assert.ok(result.every((r, i) => r.sampleStart === i * 512 && r.sampleCount === 512 && r.label === 'original' && r.confidence === 1))
  assert.throws(() => native.classifyRegion({ startSample: -1, sampleCount: 512 }), /range/)
  assert.throws(() => native.classifyRegion({ startSample: 0, sampleCount: 1 }), /shorter/)
  assert.throws(() => native.classifyRegion({ startSample: 0, sampleCount: 512, frameSize: 512 }), /match/)
  assert.throws(() => native.classifyRegion({ startSample: 0, sampleCount: NaN }), /range/)
})

test('invalid model dimensions fail without crashing or leaving a loaded classifier', () => {
  const model = path.join(dir, 'bad-classifier.json')
  for (const n_components of [-1, 0, 1000000]) {
    fs.writeFileSync(model, JSON.stringify({ ...classifierModel(), n_components }))
    assert.equal(native.loadClassifier(model).success, false)
    assert.throws(() => native.classifyRegion({ startSample: 0, sampleCount: 512 }), /No classifier/)
  }
})

function sigmfFixture(name, datatype, channels, bytes, extra = {}) {
  const file = path.join(dir, name + '.sigmf-meta')
  fs.writeFileSync(file.replace('.sigmf-meta', '.sigmf-data'), bytes)
  fs.writeFileSync(file, JSON.stringify({ global: { 'core:datatype': datatype, 'core:num_channels': channels,
    'core:version': '1.2.6', 'core:sample_rate': 8000, ...extra }, captures: [], annotations: [] }))
  return file
}

test('SigMF interleaved complex channels preserve frame counts, views, detection decimation and export', () => {
  const values = [1, -1, 101, -101, 2, -2, 102, -102, 3, -3, 103, -103, 4, -4, 104, -104]
  const file = sigmfFixture('multi', 'cf32_le', 2, Buffer.from(new Float32Array(values).buffer))
  const info = native.openFile(file, '', { channel: 1 })
  assert.equal(info.totalSamples, 4)
  assert.equal(info.numChannels, 2)
  assert.equal(info.channel, 1)
  assert.deepEqual(Array.from(native.getSamples(0, 4)), [101, -101, 102, -102, 103, -103, 104, -104])
  assert.deepEqual(Array.from(native.getSamples(0, 2, 2)), [102, -102, 104, -104])
  const outputPath = path.join(dir, 'selected-channel')
  assert.equal(native.exportSigMF({ outputPath, startSample: 1, endSample: 3, sampleRate: 8000, applyBandpass: false }).success, true)
  native.openFile(outputPath + '.sigmf-meta')
  assert.deepEqual(Array.from(native.getSamples(0, 2)), [102, -102, 103, -103])
  assert.equal(native.openFile(file, '', { channel: 0, viewStart: 1, viewLength: 2 }).totalSamples, 2)
  assert.deepEqual(Array.from(native.getSamples(0, 2)), [2, -2, 3, -3])
  for (const channel of [-1, 2, 0.5, NaN]) assert.throws(() => native.openFile(file, '', { channel }), /channel/i)
  assert.deepEqual(Array.from(native.getSamples(0, 2)), [2, -2, 3, -3])
})

test('SigMF real and complex big-endian channels decode independently', () => {
  const real = Buffer.alloc(12)
  ;[32767, -32768, 16384, -16384, 8192, -8192].forEach((x, i) => real.writeInt16BE(x, i * 2))
  native.openFile(sigmfFixture('real-be', 'ri16_be', 2, real), '', { channel: 1 })
  assert.deepEqual(Array.from(native.getSamples(0, 3)), [-1, 0, -0.5, 0, -0.25, 0])
  const complex = Buffer.alloc(32)
  ;[1.5, -2.5, 3.5, -4.5].forEach((x, i) => complex.writeDoubleBE(x, i * 8))
  native.openFile(sigmfFixture('complex-be', 'cf64_be', 2, complex), '', { channel: 1 })
  assert.deepEqual(Array.from(native.getSamples(0, 1)), [3.5, -4.5])
})

test('SigMF rejects malformed layout and datatypes instead of silently misreading IQ', () => {
  for (const channels of [0, -1, 1.5, '2']) {
    assert.throws(() => native.openFile(sigmfFixture('bad-channels', 'cf32_le', channels, Buffer.alloc(16))), /num_channels/)
  }
  assert.throws(() => native.openFile(sigmfFixture('truncated', 'cf32_le', 2, Buffer.alloc(24))), /incomplete sample frame/)
  assert.throws(() => native.openFile(sigmfFixture('unsupported', 'bogus', 1, Buffer.alloc(16))), /Unsupported SigMF datatype/)
  const broken = path.join(dir, 'broken.sigmf-meta')
  fs.writeFileSync(broken, '{broken')
  assert.throws(() => native.openFile(broken))
})

test('SigMF core:dataset resolves relative to metadata', () => {
  const file = sigmfFixture('named', 'cf32_le', 1, Buffer.alloc(16), { 'core:dataset': 'payload.bin' })
  fs.renameSync(file.replace('.sigmf-meta', '.sigmf-data'), path.join(dir, 'payload.bin'))
  assert.equal(native.openFile(file).totalSamples, 2)
  assert.equal(native.openFile(file).dataPath, path.join(dir, 'payload.bin'))
})

test('asynchronous trace reads retain their source, preserve peak decimation, and validate allocations', async () => {
  native.openFile(aPath)
  const expected = native.getSamples(0, 512, 1024)
  const pending = native.getSamplesAsync(0, 512, 1024)
  native.openFile(bPath)
  assert.deepEqual(await pending, expected)
  assert.throws(() => native.getSamplesAsync(0, 1 << 30, 1), /Invalid sample read/)
  assert.throws(() => native.getSamplesAsync(-1, 10, 1), /Invalid sample read/)
})

test('GPU tile reads preserve channels, window overlap and EOF zero padding', async () => {
  const input = new Float32Array([1,0,11,0, 2,0,12,0, 3,0,13,0, 4,0,14,0, 5,0,15,0])
  const file = sigmfFixture('gpu-windows', 'cf32_le', 2, Buffer.from(input.buffer))
  native.openFile(file, '', { channel: 1 })
  const pending = native.readFFTTile(0, 4, 2)
  native.openFile(bPath)
  assert.deepEqual(Array.from(await pending), [11,0,12,0,13,0,14,0, 13,0,14,0,15,0,0,0, 15,0,0,0,0,0,0,0])
  assert.throws(() => native.readFFTTile(0, 32768, 1), /Invalid sample read/)
})
