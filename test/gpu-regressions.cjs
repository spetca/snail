const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-gpu-'))
app.setPath('userData', path.join(dir, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
if (process.env.SNAIL_GPU_SOFTWARE === '1') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}
const native = require('../src/native/build/Release/snail_native.node')
app.whenReady().then(async () => {
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    import {GpuFFT} from './src/renderer/webgl/GpuFFT';
    import {SpectrogramRenderer} from './src/renderer/webgl/SpectrogramRenderer';
    window.GpuFFT=GpuFFT; window.SpectrogramRenderer=SpectrogramRenderer;
    window.canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=512;
    window.gl=canvas.getContext('webgl2');
  `, resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife' }).outputFiles[0].text
  fs.writeFileSync(path.join(dir, 'index.html'), `<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`)
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  const js = code => win.webContents.executeJavaScript(code)
  await win.loadFile(path.join(dir, 'index.html'))
  assert.equal(await js('!!gl'), true, 'WebGL2 must be available for the display')
  const hardware = await app.getGPUInfo('basic')
  console.log('GPU:', JSON.stringify(hardware.gpuDevice))
  const supported = await js(`!!gl.getExtension('EXT_color_buffer_float')`)
  if (supported) {
    await js('window.gpu = new GpuFFT(gl); gpu.verify()')
    for (const n of [64, 512, 2048, 8192]) {
      const input = new Float32Array(n * 4)
      let seed = 42
      for (let i = 0; i < input.length; ++i) { seed = (1664525 * seed + 1013904223) >>> 0; input[i] = seed / 4294967296 - 0.5 }
      const file = path.join(dir, 'random.cf32')
      fs.writeFileSync(file, Buffer.from(input.buffer)); native.openFile(file)
      const expected = Array.from(await native.computeFFTTile(0, n, n))
      const actual = await js(`(()=>{const t=gpu.compute(new Float32Array(${JSON.stringify(Array.from(input))}),${n});
        const result=Array.from(gpu.readPower(t,${n},2)); gl.deleteTexture(t); return result})()`)
      let maxError = 0
      for (let i = 0; i < actual.length; ++i) { assert.ok(Number.isFinite(actual[i])); maxError = Math.max(maxError, Math.abs(actual[i] - expected[i])) }
      assert.ok(maxError < 0.15, `GPU FFT ${n} differs from native by ${maxError} dB`)
      console.log(`GPU FFT ${n}: max native difference ${maxError.toFixed(5)} dB (half-float display)`)
    }
    const silence = await js(`(()=>{const t=gpu.compute(new Float32Array(128),64);const data=Array.from(gpu.readPower(t,64,1));gl.deleteTexture(t);return data})()`)
    assert.ok(silence.every(v => v === -200))
    // A positive-frequency bin must land above DC after fftshift.
    const tone = await js(`(()=>{const n=512,input=new Float32Array(n*2);for(let i=0;i<n;i++){input[i*2]=Math.cos(2*Math.PI*37*i/n);input[i*2+1]=Math.sin(2*Math.PI*37*i/n)}
      const t=gpu.compute(input,n);const a=gpu.readPower(t,n,1);gl.deleteTexture(t);return {index:a.indexOf(Math.max(...a)),peak:Math.max(...a)}})()`)
    assert.equal(tone.index, 256 + 37)
    assert.ok(Math.abs(tone.peak - (-6.0376)) < 0.05)
    console.log('GPU tone orientation, window normalization and silence verified.')
    if (process.env.SNAIL_GPU_BENCHMARK === '1') {
      for (const n of [1024, 8192]) {
        const timing = await js(`(async()=>{
          const n=${n}, input=new Float32Array(n*256*2); for(let i=0;i<input.length;i++)input[i]=Math.sin(i*.13);
          const times=[]; for(let k=0;k<6;k++){const start=performance.now();const t=gpu.compute(input,n);await gpu.finished();gl.deleteTexture(t);if(k)times.push(performance.now()-start)}
          times.sort((a,b)=>a-b); return times[2];
        })()`)
        console.log(`GPU ${n}: upload + FFT + power texture + completion fence, median ${timing.toFixed(2)} ms / 256 rows (excludes disk/IPC)`)
      }
    }
    await js('gpu.dispose()')
  } else console.log('GPU float FFT unavailable: testing CPU display fallback.')

  // Unsupported float render targets must still permit CPU FFT textures and large FFT sizes.
  const fallback = await js(`(async()=>{
    const original=gl.getExtension.bind(gl); gl.getExtension=name=>name==='EXT_color_buffer_float'?null:original(name);
    const renderer=new SpectrogramRenderer(canvas); gl.getExtension=original;
    renderer.resize(1024,512);
    window.snailAPI={computeFFTTile:async()=>new Float32Array(32768*2).fill(-42)};
    await renderer.loadTile('0_32768_32768',{recordingId:'test',startSample:0,fftSize:32768,stride:32768});
    renderer.render({scrollOffset:0,fftSize:32768,stride:32768,powerMin:-100,powerMax:0,totalSamples:65536});
    const result={cached:renderer.hasTile('0_32768_32768'),error:gl.getError(),gpu:!!renderer.gpu};
    renderer.dispose(); return result;
  })()`)
  assert.deepEqual(fallback, { cached: true, error: 0, gpu: false })
  if (supported) {
    const recovery = await js(`(async()=>{
      const renderer=new SpectrogramRenderer(canvas); renderer.resize(1024,512);
      let cpuCalls=0;
      window.snailAPI={computeFFTTile:async()=>{cpuCalls++;return new Float32Array(512).fill(-42)},readFFTTile:async()=>new Float32Array(1024)};
      renderer.backend.set(512,{cpuMs:1000});
      renderer.gpu.compute=()=>{throw new Error('Simulated driver failure')};
      await renderer.loadTile('0_512_512',{recordingId:'failure',startSample:0,fftSize:512,stride:512});
      await renderer.loadTile('512_512_512',{recordingId:'failure',startSample:512,fftSize:512,stride:512});
      const result={cpuCalls,cached:renderer.hasTile('0_512_512'),gpu:renderer.backend.get(512).gpu};
      renderer.dispose();return result;
    })()`)
    assert.deepEqual(recovery, { cpuCalls: 2, cached: true, gpu: false })
  }
  console.log('PASS: GPU FFT agrees with native DSP; unsupported devices retain CPU display with texture-limit handling.')
  win.destroy()
}).then(() => { fs.rmSync(dir, { recursive: true, force: true }); app.exit(0) }).catch(error => {
  console.error(error); fs.rmSync(dir, { recursive: true, force: true }); app.exit(1)
})
