const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path'), assert = require('assert/strict')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snail-desktop-'))
app.setPath('userData', path.join(dir, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const { buildSync } = require(path.join(root, 'node_modules/esbuild'))
  const bundle = buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import App from './src/renderer/App'; import {useStore} from './src/renderer/state/store';
    import {ErrorBoundary} from './src/renderer/components/ErrorBoundary';
    import {PartialImportDialog} from './src/renderer/components/PartialImportDialog';
    window.errors=[]; window.addEventListener('error', e=>window.errors.push(e.message));
    window.fftUpdates=0;
    window.project={schemaVersion:1,sourceKey:'smoke',source:{},revision:0,proposals:[],runs:[]};
    window.snailRun=null;window.scanCalls=0;
    const snapshot = id => ({recordingId:id,project:structuredClone(window.project),progress:window.snailRun});
    window.datasetJob=null;
    window.snailAPI={
      getDatasetState: async () => window.datasetJob,
      exportDataset: async request => {
        window.lastDatasetRequest=request;
        window.datasetJob={id:'export-1',recordingId:request.recordingId,status:'complete',stage:'complete',completed:1,total:1,eventCount:1,outputPath:'/synthetic/dataset'};
        return window.datasetJob;
      },
      cancelDataset: async () => {},
      getDetectionState: async id => snapshot(id),
      resetDetection: async (id, revision) => {
        window.lastResetRevision=revision;
        window.project={...window.project,revision:revision+1,proposals:[],runs:[]};window.snailRun=null;
        return snapshot(id);
      },
      startDetection: async req => {
        window.scanCalls++;window.lastDetectionRequest=req;
        window.snailRun={id:'run-1',status:'complete',startSample:req.startSample,endSample:req.endSample,processedUntil:req.endSample,candidateCount:1};
        window.project={...window.project,revision:window.project.revision+1,proposals:[{id:'event-1',fingerprint:'fp',runId:'run-1',revision:1,status:'proposed',
          label:'',comment:'',sampleStart:req.startSample+10000,sampleCount:10000,freqLowerEdge:10000,freqUpperEdge:30000,peakAboveNoiseDb:20,frames:20,touchesBoundary:false,history:[]}]};
        return snapshot(req.recordingId);
      },
      reviewProposal: async req => {
        window.lastReview=req;
        window.project={...window.project,revision:window.project.revision+1,proposals:window.project.proposals.map(p=>({...p,...req.patch,revision:p.revision+1,status:req.action==='accept'?'accepted':'proposed'}))};
        return {project:structuredClone(window.project),sigmfMetaJson:JSON.stringify({global:{},captures:[{'core:sample_start':0,'core:frequency':100000000}],annotations:[{
          'core:sample_start':req.patch.sampleStart,'core:sample_count':req.patch.sampleCount,'core:freq_lower_edge':100000000+req.patch.freqLowerEdge,
          'core:freq_upper_edge':100000000+req.patch.freqUpperEdge,'core:label':req.patch.label}]})};
      },
      sendFFTUpdate(){window.fftUpdates++},sendConstellationUpdate(){},
      computeFFTTile: async req => new Float32Array(req.fftSize*256).fill(-40),
      getSamples: async (start,count) => new Float32Array(count*2),
      computeFFT: async ()=>({data:new Float32Array(512),minPower:-120,maxPower:0}) };
    window.store=useStore;
    useStore.getState().setFileInfo({recordingId:'smoke-A',path:'/smoke.cf32',sampleRate:1000000,totalSamples:2000000,fileSize:16000000,format:'cf32',centerFrequency:100000000});
    const root = createRoot(document.getElementById('root'));
    root.render(<ErrorBoundary><App/></ErrorBoundary>);
    window.showImportProbe = () => root.render(<PartialImportDialog filePath="/synthetic.cf32"
      probe={{sampleRate:1000000,totalSamples:2000000,fileSize:16000000,format:'cf32'}}
      onConfirm={(start,count)=>{window.importResult={start,count}}} onCancel={()=>{}}/>);
  `, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } }).outputFiles[0].text
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles/global.css'),'utf8').split('\n').filter(line => !line.startsWith('@import')).join('\n')
  fs.writeFileSync(path.join(dir,'index.html'), `<html><head><style>${css}</style></head><body><div id="root"></div><script>${bundle.replace(/<\/script/gi,'<\\/script')}</script></body></html>`)
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
  const js = script => win.webContents.executeJavaScript(script)
  await win.loadFile(path.join(dir,'index.html')); await pause(400)
  assert.equal(await js(`getComputedStyle(document.body).backgroundColor`), 'rgb(10, 14, 20)')
  await js(`Array.from(document.querySelectorAll('label')).find(x=>x.textContent.includes('Enable cursors')).querySelector('input').click()`)
  await pause(150)
  assert.equal(await js(`document.getElementById('root').textContent.includes('Cursor Info')`), true)
  assert.deepEqual(await js('window.errors'), [])
  const rect = await js(`(()=>{const r=document.querySelector('[data-spectrogram-overlay]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
  const event = (type,x,y,extra={}) => win.webContents.sendInputEvent({type,x:Math.round(rect.x+x),y:Math.round(rect.y+y),...extra})
  event('mouseMove',60,60); event('mouseDown',60,60,{button:'left',clickCount:1}); await pause(35)
  event('mouseMove',200,140,{button:'left'}); await pause(35); event('mouseUp',200,140,{button:'left',clickCount:1}); await pause(80)
  const selected = await js('window.store.getState().selection')
  assert.equal(selected.sample1,60*512); assert.equal(selected.sample2,200*512)
  assert.notEqual(selected.frequency1, selected.frequency2)
  const fftUpdates = await js('window.fftUpdates')
  event('mouseWheel',150,110,{deltaY:-30,deltaX:0,canScroll:true,modifiers:['control']}); await pause(120)
  assert.deepEqual(await js('window.store.getState().selection'), selected)
  assert.notEqual(await js('window.store.getState().zoomLevel'),1)
  win.setSize(1100,700); await pause(160)
  assert.equal(await js('window.fftUpdates'), fftUpdates, 'Viewport changes must not rerun selection FFTs')
  assert.deepEqual(await js('window.store.getState().selection'), selected)
  await js(`window.gl=document.querySelector('[data-spectrogram-overlay]').parentElement.querySelector('canvas').getContext('webgl2');window.lose=gl.getExtension('WEBGL_lose_context'); if(lose)lose.loseContext()`)
  await pause(150)
  assert.equal(await js('!!window.lose'), true, 'This smoke test requires WebGL context-loss support')
  if (await js('!!window.lose')) {
    assert.equal(await js(`document.getElementById('root').textContent.includes('graphics context was lost')`), true)
    await js('window.lose.restoreContext()');
    for (let i=0;i<30 && await js(`document.getElementById('root').textContent.includes('graphics context was lost')`);i++) await pause(100)
    assert.equal(await js(`document.getElementById('root').textContent.includes('graphics context was lost')`), false)
  }
  const clickText = async text => { await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`); await pause(120) }
  await clickText('Detect & label')
  const draftValue = label => js(`document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]').value`)
  const beginTyping = async label => { await js(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');el.focus();el.select()})()`) }
  const typeCharacters = async text => { for(const character of text){await win.webContents.insertText(character);await pause(20)} }
  await beginTyping('Minimum power (dB)')
  await typeCharacters('-')
  assert.equal(await draftValue('Minimum power (dB)'), '-', 'Minus sign must survive as an editable draft')
  await clickText('Find transmissions')
  assert.equal(await js('window.scanCalls'), 0, 'Invalid draft must block scanning instead of submitting an old value')
  await beginTyping('Minimum power (dB)')
  await typeCharacters('-100')
  assert.equal(await draftValue('Minimum power (dB)'), '-100')
  await beginTyping('Sample rate (Hz)')
  await typeCharacters('1e')
  assert.equal(await draftValue('Sample rate (Hz)'), '1e')
  assert.equal(await js('window.store.getState().sampleRate'), 1000000)
  await typeCharacters('6')
  await js(`document.querySelector('[aria-label="Sample rate (Hz)"]').blur()`)
  assert.equal(await js('window.store.getState().sampleRate'), 1000000)
  await clickText('Find transmissions')
  assert.equal(await js('window.lastDetectionRequest.config.minimumPowerDb'), -100)
  assert.equal(await js(`document.querySelector('[aria-label="Review candidate 1"]')!==null`), true)
  const setNumber = async (label, value) => {
    await js(`(()=>{const input=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await pause(80)
  }
  await beginTyping('Min pulse width (ms)')
  await typeCharacters('0.')
  assert.equal(await draftValue('Min pulse width (ms)'), '0.', 'Decimal point must not be normalized away')
  await typeCharacters('125')
  assert.equal(await draftValue('Min pulse width (ms)'), '0.125')
  await setNumber('Min pulse width (ms)', '')
  assert.equal(await draftValue('Min pulse width (ms)'), '', 'Optional bounds must remain clearable')
  await setNumber('Min pulse width (ms)', '11')
  assert.equal(await js(`document.querySelector('[aria-label="Review candidate 1"]')!==null`), false)
  await setNumber('Min pulse width (ms)', '10')
  await setNumber('Max bandwidth (kHz)', '19')
  assert.equal(await js(`document.querySelector('[aria-label="Review candidate 1"]')!==null`), false)
  await setNumber('Max bandwidth (kHz)', '20')
  assert.equal(await js(`document.querySelector('[aria-label="Review candidate 1"]')!==null`), true)
  await js(`document.querySelector('[aria-label="Review candidate 1"]').click()`); await pause(100)
  assert.equal(await js('window.store.getState().selection.sample1'), 10000)
  assert.equal(await js('window.store.getState().selection.frequency1'), 30000)
  await js(`(()=>{const input=document.querySelector('[aria-label="Event label"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'test beacon');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await pause(100)
  assert.equal(await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Accept label').disabled`), false)
  await clickText('Accept label')
  assert.equal(await js('window.lastReview.patch.label'), 'test beacon')
  assert.equal(await js('window.store.getState().eventProject.proposals[0].status'), 'accepted')
  assert.equal(await js('window.store.getState().annotations[0].label'), 'test beacon')
  assert.equal(await js('window.store.getState().detectionError'), null)
  await js(`(()=>{const input=document.querySelector('[aria-label="Dataset contents"]');input.value='channelized';input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await pause(80)
  await clickText('Export accepted dataset')
  assert.equal(await js('window.lastDatasetRequest.mode'), 'channelized')
  assert.equal(await js('window.lastDatasetRequest.expectedRevision'), 2)
  assert.equal(await js(`document.querySelector('[aria-label="Dataset export"]').textContent.includes('/synthetic/dataset')`), true)
  await js(`Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Queue management').click()`)
  await clickText('Reset review queue')
  assert.equal(await js('window.lastResetRevision'), 2)
  assert.equal(await js('window.store.getState().eventProject.proposals.length'), 0)
  assert.equal(await js('window.store.getState().annotations[0].label'), 'test beacon')
  await js(`document.querySelector('[aria-label=\"Close detection panel\"]').click()`)
  await js(`window.store.getState().setFileInfo({recordingId:'smoke-B',path:'/smoke-B.cf32',sampleRate:1000000,totalSamples:2000000,fileSize:16000000,format:'cf32'})`)
  await pause(200)
  assert.equal(await js('window.store.getState().selection'), null)
  assert.deepEqual(await js('window.errors'), [])
  await js(`window.store.getState().setShowDetectionPanel(true);window.store.setState({cursors:{...window.store.getState().cursors,enabled:false},scrollOffset:500000,zoomLevel:2,yZoomLevel:4,yScrollOffset:80})`)
  await pause(200)
  await js(`(()=>{const input=document.querySelector('[aria-label="Power threshold mode"]');input.value='absolute';input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await pause(80)
  await beginTyping('Absolute threshold (dB)')
  await typeCharacters('-100')
  assert.equal(await draftValue('Absolute threshold (dB)'), '-100')
  await setNumber('Absolute threshold (dB)', '-50')
  await clickText('Find transmissions')
  assert.equal(await js('window.lastDetectionRequest.config.thresholdMode'), 'absolute')
  assert.equal(await js('window.lastDetectionRequest.config.minimumPowerDb'), -50)
  assert.equal(await js('window.lastDetectionRequest.startSample'), 500000)
  assert.equal(await js('window.lastDetectionRequest.endSample'), await js('Math.min(2000000,Math.ceil(500000+window.store.getState().viewWidth*256))'))
  assert.deepEqual(await js('window.lastDetectionRequest.frequencyRange'), {low:-62500,high:187500})
  const highlightPixels = () => js(`(()=>{const c=document.querySelector('[data-spectrogram-overlay] canvas');if(!c)return 0;const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<p.length;i+=4)if(p[i]>100)count++;return count})()`)
  assert.ok(await highlightPixels() > 0, 'Current-view candidates must paint before selecting one, with cursors off')
  await js(`window.store.setState({eventProject:{...window.store.getState().eventProject,proposals:window.store.getState().eventProject.proposals.map(p=>({...p,sampleStart:510000,sampleCount:1,freqLowerEdge:20000,freqUpperEdge:20001}))}})`)
  await pause(100)
  assert.ok(await highlightPixels() >= 16, 'Subpixel candidates must remain visible at the current zoom')
  fs.writeFileSync(path.join(dir,'smoke.png'), (await win.webContents.capturePage()).toPNG())
  await js('window.showImportProbe()'); await pause(100)
  await setNumber('Import end (seconds)', '')
  await clickText('Load Selection')
  assert.equal(await js('window.importResult'), undefined, 'Blank import bounds must not submit stale values')
  await setNumber('Import start (seconds)', '1')
  await setNumber('Import end (seconds)', '0.5')
  await clickText('Load Selection')
  assert.equal(await js('window.importResult'), undefined, 'Reversed ranges must not submit')
  await setNumber('Import start (seconds)', '1.25e-1')
  await setNumber('Import end (seconds)', '0.25')
  await clickText('Load Selection')
  assert.deepEqual(await js('window.importResult'), {start:125000,count:125000})
  console.log('PASS: Electron cursor toggle, rectangle drag, wheel zoom, resize, WebGL loss/recovery, detection review/acceptance, dataset export controls, width/bandwidth filters, queue reset, current-view ROI and canvas highlights, file switch, numeric keyboard entry and import validation.')
  win.destroy(); fs.rmSync(dir, { recursive: true, force: true }); app.exit(0)
}).catch(error => { console.error(error); console.error('Smoke artifacts:', dir); app.exit(1) })
