const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// Use the project's TypeScript dependency; no browser/native addon is needed.
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    })
    module._compile(result.outputText, filename)
  }
}
// Read current snapshots during SSR while retaining Zustand's real store/actions.
const zustand = require('zustand/react')
const create = zustand.create
zustand.create = (initializer) => create((set, get, api) => {
  api.getInitialState = get
  return initializer(set, get, api)
})
const { useStore } = require('../src/renderer/state/store.ts')
zustand.create = create
const { ControlsPanel } = require('../src/renderer/components/ControlsPanel.tsx')
const { useCursors } = require('../src/renderer/hooks/useCursors.ts')
const { useSpectrogram } = require('../src/renderer/hooks/useSpectrogram.ts')
const { tsfft } = require('../src/renderer/utils/fft.ts')
const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function readHook(hook) {
  let result
  function Probe() { result = hook(); return null }
  renderToStaticMarkup(React.createElement(Probe))
  return result
}

for (const absolute of [false, true]) {
  test(`cursor panel renders with absolute frequency ${absolute}`, () => {
    useStore.setState({
      fileInfo: { path: '/test.cf32', totalSamples: 100000, fileSize: 800000,
        format: 'cf32', sampleRate: 1000000, centerFrequency: 100000000 },
      sampleRate: 1000000, viewHeight: 400, viewWidth: 800,
      cursors: { enabled: true, x1: 20, x2: 80, y1: 100, y2: 300 },
      showAbsoluteFrequency: absolute
    })
    const html = renderToStaticMarkup(React.createElement(ControlsPanel))
    assert.match(html, /Cursor Info/)
    assert.match(html, /500\.000 kHz/)
    if (absolute) assert.match(html, /100\.250 MHz/)
    useStore.getState().setCursorsEnabled(false)
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(ControlsPanel)), /Cursor Info/)
  })
}

test('cursor ranges and coordinate transforms match integer FFT stride after scrolling', () => {
  useStore.setState({ fftSize: 512, zoomLevel: 3, scrollOffset: 10000, sampleRate: 1000,
    cursors: { enabled: true, x1: 10.25, x2: 2.5, y1: 0, y2: 1 } })
  const cursors = readHook(useCursors)
  assert.deepEqual(cursors.sampleRange, { start: 10428, end: 11753, delta: 1325 })
  assert.equal(cursors.timeRange.delta, 1.325)
  const view = readHook(useSpectrogram)
  assert.equal(view.samplesPerColumn, 171)
  assert.equal(view.sampleToPixel(view.pixelToSample(23)), 23)
})

test('frequency conversion accounts for vertical zoom and scroll', () => {
  useStore.setState({ fftSize: 512, yZoomLevel: 2, yScrollOffset: 64 })
  const view = readHook(useSpectrogram)
  assert.equal(view.pixelToFrequency(0, 400, 1000), 250)
  assert.equal(view.pixelToFrequency(200, 400, 1000), 0)
  assert.equal(view.pixelToFrequency(400, 400, 1000), -250)
  assert.equal(view.pixelToFrequency(0, 0, 1000), 0)
})

test('constellation FFT agrees with direct complex DFT, including bit-reversal swaps', () => {
  const real = [2, -1, 3, 0, 0.5, 4, -2, 1]
  const imag = [1, 2, 0, -3, 1, 0.5, 0, 2]
  const re = Float64Array.from(real), im = Float64Array.from(imag)
  tsfft(re, im)
  for (let k = 0; k < real.length; k++) {
    let expectedRe = 0, expectedIm = 0
    for (let n = 0; n < real.length; n++) {
      const angle = -2 * Math.PI * k * n / real.length
      expectedRe += real[n] * Math.cos(angle) - imag[n] * Math.sin(angle)
      expectedIm += real[n] * Math.sin(angle) + imag[n] * Math.cos(angle)
    }
    assert.ok(Math.abs(re[k] - expectedRe) < 1e-10)
    assert.ok(Math.abs(im[k] - expectedIm) < 1e-10)
  }
})

const { RecordingSession } = require('../src/main/recording-session.ts')
const { recordingJob, openRecording } = require('../src/renderer/utils/recording.ts')
const { captureSegments, annotationBands, readAnnotations, annotationRecords } = require('../src/shared/sigmf.ts')
const { saveAnnotationMetadata, metadataPaths } = require('../src/main/annotation-metadata.ts')
const os = require('node:os'), path = require('node:path')

const file = (id = 'A') => ({ recordingId: id, path: '/test.cf32', totalSamples: 1000000,
  fileSize: 8000000, format: 'cf32', sampleRate: 1000000, centerFrequency: 100000000 })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('opening a recording resets derived analysis and preserves app preferences/model', () => {
  useStore.setState({ classificationResults: [{ label: 'old' }], pendingExport: { start: 12, end: 30 },
    selectedAnnotationIndex: 3, isPlaying: true, playheadSample: 100, showExportDialog: true,
    showAnnotationDialog: true, fftResult: {}, correlationData: new Float32Array([1]),
    correlationLoading: true, correlationEnabled: true, correlationFilePath: '/old.cf32',
    classifierLoaded: true, classifierLabels: ['kept'], powerMin: -80 })
  useStore.getState().setFileInfo(file('B'))
  const s = useStore.getState()
  for (const key of ['pendingExport', 'selectedAnnotationIndex', 'fftResult', 'correlationData', 'correlationFilePath', 'selection']) assert.equal(s[key], null)
  for (const key of ['isPlaying', 'showExportDialog', 'showAnnotationDialog', 'correlationLoading', 'correlationEnabled']) assert.equal(s[key], false)
  assert.deepEqual(s.classificationResults, [])
  assert.equal(s.playheadSample, 0)
  assert.equal(s.classifierLoaded, true)
  assert.deepEqual(s.classifierLabels, ['kept'])
  assert.equal(s.powerMin, -80)
})

test('physical selection survives X/Y zoom, scrolling, FFT changes, resize, and fit', () => {
  const s = useStore.getState()
  s.setFileInfo(file())
  s.setCursorsEnabled(true)
  s.setCursorX(11.2, 57.8)
  s.setCursorY(110, 320)
  const selected = { ...useStore.getState().selection }
  s.setZoomLevel(3)
  s.setScrollOffset(90000)
  s.setYZoomLevel(4)
  s.setYScrollOffset(32)
  s.setViewWidth(333)
  s.setViewHeight(180)
  s.setFFTSize(1024)
  assert.deepEqual(useStore.getState().selection, selected)
  const range = readHook(useCursors).sampleRange
  assert.equal(range.start, selected.sample1)
  assert.equal(range.end, selected.sample2)
  s.snapToView()
  assert.deepEqual(useStore.getState().selection, selected)
  s.setCursorsEnabled(false)
  s.setCursorsEnabled(true)
  assert.deepEqual(useStore.getState().selection, selected)
})

test('initial selection is clamped at EOF and X/Y setters preserve the other axis', () => {
  useStore.getState().setFileInfo({ ...file(), totalSamples: 1000 })
  const s = useStore.getState()
  s.setCursorsEnabled(true)
  assert.ok(useStore.getState().selection.sample2 <= 1000)
  s.setCursorX(0, 1)
  const samples = useStore.getState().selection
  s.setCursorY(22, 77)
  assert.equal(useStore.getState().selection.sample1, samples.sample1)
  assert.equal(useStore.getState().selection.sample2, samples.sample2)
})

test('IPC rejects old requests before starting work and old responses after completion', async () => {
  const session = new RecordingSession()
  const a = session.open(() => file())
  const pending = deferred()
  const result = session.run(a.recordingId, () => pending.promise)
  const b = session.open(() => file()) // same path, different identity
  assert.notEqual(a.recordingId, b.recordingId)
  let ran = false
  await assert.rejects(session.run(a.recordingId, () => { ran = true }), /Recording changed/)
  assert.equal(ran, false)
  pending.resolve('old result')
  await assert.rejects(result, /Recording changed/)
  assert.equal(await session.run(b.recordingId, () => 'new result'), 'new result')
  assert.throws(() => session.open(() => { throw new Error('missing') }), /missing/)
  assert.equal(session.current.recordingId, b.recordingId)
})

test('renderer jobs and overlapping opens cannot repopulate a newer recording', async () => {
  useStore.getState().setFileInfo(file('old'))
  const job = recordingJob()
  const a = deferred(), b = deferred()
  global.window = { snailAPI: { openFile: name => name === 'a' ? a.promise : b.promise } }
  const first = openRecording('a'), second = openRecording('b')
  b.resolve(file('B'))
  await second
  a.resolve(file('A'))
  await first
  assert.equal(useStore.getState().fileInfo.recordingId, 'B')
  assert.equal(job.isCurrent(), false)
  assert.throws(job.assertCurrent, /Recording changed/)
})

function captureFile() {
  return { ...file(), totalSamples: 1000, sigmfMetaJson: JSON.stringify({
    global: { 'core:sample_rate': 1000000, 'custom:kept': true },
    captures: [ { 'core:sample_start': 0, 'core:frequency': 100000000 },
      { 'core:sample_start': 500, 'core:frequency': 200000000 } ], annotations: []
  }) }
}

test('RF annotations spanning retunes render separately at the correct baseband bounds', () => {
  const info = captureFile()
  const bands = annotationBands([{ sampleStart: 450, sampleCount: 100,
    freqLowerEdge: 100010000, freqUpperEdge: 100020000 }], info, 'rf')
  assert.equal(bands.length, 2)
  assert.equal(bands[0].annotation.freqLowerEdge, 10000)
  assert.equal(bands[1].annotation.freqLowerEdge, -99990000)
  assert.equal(bands[0].annotation.sampleCount, 50)
  assert.equal(bands[1].index, 0)
  const records = annotationRecords({ sampleStart: 450, sampleCount: 100,
    freqLowerEdge: 10000, freqUpperEdge: 20000, label: 'burst' }, info)
  assert.equal(records[0]['core:freq_lower_edge'], 100010000)
  assert.equal(records[1]['core:freq_lower_edge'], 200010000)
  assert.equal(records[1]['core:sample_start'], 500)
})

test('missing capture frequency does not inherit tuning; missing count ends at capture boundary', () => {
  const info = captureFile(), meta = JSON.parse(info.sigmfMetaJson)
  delete meta.captures[1]['core:frequency']
  meta.annotations = [{ 'core:sample_start': 490 }]
  info.sigmfMetaJson = JSON.stringify(meta)
  assert.equal(captureSegments(info)[1].frequency, 0)
  assert.equal(readAnnotations(info)[0].sampleCount, 10)
  assert.throws(() => annotationRecords({ sampleStart: 0, sampleCount: 0 }, info), /nonempty/)
  assert.throws(() => annotationRecords({ sampleStart: 0, sampleCount: 2, freqLowerEdge: 1 }, info), /frequency bounds/)
})

test('atomic metadata saves preserve unknown fields, migrate explicit legacy coordinates, and reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-meta-'))
  try {
    const info = { ...captureFile(), path: path.join(dir, 'recording.sigmf-meta') }
    const metaPath = metadataPaths(info.path).meta
    assert.equal(metaPath, info.path)
    const meta = JSON.parse(info.sigmfMetaJson)
    meta.annotations = [{ 'core:sample_start': 700, 'core:sample_count': 30,
      'core:freq_lower_edge': 10000, 'core:freq_upper_edge': 20000, 'custom:evidence': 'keep me' }]
    fs.writeFileSync(metaPath, JSON.stringify(meta))
    const output = saveAnnotationMetadata(info, { sampleStart: 100, sampleCount: 20,
      freqLowerEdge: -10000, freqUpperEdge: 10000, label: 'new' }, 'legacy-baseband')
    const saved = JSON.parse(output)
    assert.equal(saved.global['custom:kept'], true)
    assert.equal(saved.annotations[1]['custom:evidence'], 'keep me')
    assert.equal(saved.annotations[1]['core:freq_lower_edge'], 200010000)
    assert.equal(saved.annotations[0]['core:freq_lower_edge'], 99990000)
    const reloaded = { ...info, sigmfMetaJson: output }
    assert.equal(annotationBands(readAnnotations(reloaded), reloaded, 'rf')[1].annotation.freqLowerEdge, 10000)
    assert.deepEqual(fs.readdirSync(dir), ['recording.sigmf-meta'])
    fs.writeFileSync(metaPath, '{broken')
    assert.throws(() => saveAnnotationMetadata(info, { sampleStart: 0, sampleCount: 20 }, 'rf'))
    assert.equal(fs.readFileSync(metaPath, 'utf8'), '{broken')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('new raw-IQ sidecar describes the actual datatype, sample rate, and dataset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-raw-meta-'))
  try {
    const info = { ...file(), path: path.join(dir, 'raw.cs16'), format: 'cs16', sampleRate: 2000000 }
    const meta = JSON.parse(saveAnnotationMetadata(info, { sampleStart: 2, sampleCount: 10 }, 'rf'))
    assert.equal(meta.global['core:datatype'], 'cs16_le')
    assert.equal(meta.global['core:sample_rate'], 2000000)
    assert.equal(meta.global['core:dataset'], 'raw.cs16')
    assert.equal(meta.annotations[0]['core:sample_start'], 2)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
