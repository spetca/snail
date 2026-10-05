// Exercise real collection IPC, native samples, and toolbar selectors in Electron.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-sigmf-ui-'))
app.setPath('userData', path.join(dir, 'profile'))
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const streams = [0, 1].map(i => {
    const name = `stream-${i}`
    const meta = JSON.stringify({ global: { 'core:datatype': 'cf32_le', 'core:num_channels': 2,
      'core:version': '1.2.6', 'core:sample_rate': 8000 }, captures: [], annotations: [] })
    fs.writeFileSync(path.join(dir, name + '.sigmf-meta'), meta)
    fs.writeFileSync(path.join(dir, name + '.sigmf-data'), Buffer.from(new Float32Array([1+i, 0, 10+i, 0, 2+i, 0, 20+i, 0]).buffer))
    return { name, hash: createHash('sha512').update(meta).digest('hex') }
  })
  const collection = path.join(dir, 'test.sigmf-collection')
  fs.writeFileSync(collection, JSON.stringify({ collection: { 'core:version': '1.2.6', 'core:streams': streams } }))
  require('../src/main/ipc-handlers.ts').registerIpcHandlers()
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Toolbar} from './src/renderer/components/Toolbar';
    import {useStore} from './src/renderer/state/store';
    import {openRecording} from './src/renderer/utils/recording';
    window.store=useStore; window.openRecording=openRecording;
    createRoot(document.getElementById('root')).render(<Toolbar onOpen={()=>{}} onExport={()=>{}} onAnnotate={()=>{}} onHopTable={()=>{}}/>);
  `, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife' }).outputFiles[0].text
  fs.writeFileSync(path.join(dir, 'index.html'), `<div id="root"></div><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`)
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'out/preload/index.js') } })
  const js = code => win.webContents.executeJavaScript(code)
  const waitFor = async condition => {
    for (let i=0;i<100;i++) { if (await js(condition)) return; await pause(20) }
    throw new Error(`Timed out: ${condition}`)
  }
  await win.loadFile(path.join(dir, 'index.html'))
  await js(`window.openRecording(${JSON.stringify(collection)})`)
  await waitFor(`!!document.querySelector('[aria-label="Channel"]')`)
  assert.equal(await js('window.store.getState().fileInfo.totalSamples'), 2)
  const firstId = await js('window.store.getState().fileInfo.recordingId')
  await js(`const input=document.querySelector('[aria-label="Channel"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1');
    input.dispatchEvent(new Event('input',{bubbles:true}));`)
  await waitFor('window.store.getState().fileInfo.channel === 1')
  assert.deepEqual(await js(`(async()=>Array.from(await window.snailAPI.getSamples(0,2,1,window.store.getState().fileInfo.recordingId)))()`), [10,0,20,0])
  assert.notEqual(await js('window.store.getState().fileInfo.recordingId'), firstId)
  await js(`const select=document.querySelector('[aria-label="Collection stream"]'); select.value='1'; select.dispatchEvent(new Event('change',{bubbles:true}));`)
  await waitFor('window.store.getState().fileInfo.collection.streamIndex === 1')
  assert.deepEqual(await js(`(async()=>Array.from(await window.snailAPI.getSamples(0,2,1,window.store.getState().fileInfo.recordingId)))()`), [2,0,3,0])
  assert.equal(await js('window.store.getState().error'), null)
  win.destroy()
  console.log('SigMF desktop integration: collection and channel selectors read the correct native samples.')
}).then(() => { fs.rmSync(dir, { recursive: true, force: true }); app.exit(0) }).catch(error => {
  console.error(error); fs.rmSync(dir, { recursive: true, force: true }); app.exit(1)
})
