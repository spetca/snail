const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const native = require('../src/native/build/Release/snail_native.node')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-install-'))
try {
  const filename = path.join(temporary, 'smoke.sigmf-data')
  const samples = new Float32Array([1, 0, 0.25, -0.5])
  fs.writeFileSync(filename, Buffer.from(samples.buffer))
  fs.writeFileSync(filename.replace('.sigmf-data', '.sigmf-meta'), JSON.stringify({
    global: { 'core:datatype': 'cf32_le', 'core:version': '1.2.6', 'core:sample_rate': 8000 }, captures: [], annotations: []
  }))
  assert.equal(native.openFile(filename).totalSamples, 2)
  assert.deepEqual(Array.from(native.getSamples(0, 2)), Array.from(samples))
  console.log('Native addon loaded and SigMF recording read successfully.')
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
