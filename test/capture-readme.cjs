// Capture the real renderer, IPC handlers, and native DSP using a disposable synthetic recording.
// Run after npm run build and building the native addon: npm run screenshots
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snail-readme-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename)

function recording() {
  const rate = 256000, count = rate * 2, iq = new Float32Array(count*2)
  let seed = 42
  const random = () => { seed = (1664525*seed+1013904223)>>>0; return seed/4294967296 }
  for (let n=0;n<count;n++) { iq[2*n] = (random()-.5)*.012; iq[2*n+1] = (random()-.5)*.012 }
  const add = (start, duration, frequency, slope=0, fsk=false) => {
    const first = Math.round(start*rate), length = Math.round(duration*rate)
    let phase = 0
    for (let i=0;i<length;i++) {
      const f = frequency+slope*i/length+(fsk ? (Math.floor(i/256)%2 ? 2200 : -2200) : 0)
      phase += 2*Math.PI*f/rate
      const ramp = Math.min(1,i/128,(length-i)/128), amplitude=.5*ramp
      iq[2*(first+i)] += amplitude*Math.cos(phase); iq[2*(first+i)+1] += amplitude*Math.sin(phase)
    }
  }
  for (let k=0;k<7;k++) add(.10+k*.25,.095,52000,0,true)
  for (let k=0;k<4;k++) add(.18+k*.43,.22,-60000,38000)
  for (let k=0;k<9;k++) add(.05+k*.215,.035,-95000)
  for (let k=0;k<6;k++) add(.22+k*.28,.055,10000+(k%3)*9000)
  const filename = path.join(temporary,'synthetic-rf-workbench.sigmf-data')
  const bytes = Buffer.alloc(iq.length*4)
  for(let i=0;i<iq.length;i++) bytes.writeFloatLE(iq[i],i*4)
  fs.writeFileSync(filename,bytes)
  fs.writeFileSync(filename.replace('.sigmf-data','.sigmf-meta'),JSON.stringify({
    global:{'core:datatype':'cf32_le','core:sample_rate':rate,'core:version':'1.2.5','core:description':'Synthetic documentation fixture: FSK-like bursts, linear chirps, pulsed carriers and hopping tones.'},
    captures:[{'core:sample_start':0,'core:frequency':433920000}],annotations:[]
  }))
  return filename
}

app.whenReady().then(async()=>{
  const filename = recording()
  require('../src/main/ipc-handlers.ts').registerIpcHandlers()
  const {buildSync} = require('esbuild')
  const bundle = buildSync({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import App from './src/renderer/App'; import {useStore} from './src/renderer/state/store';
    import {ErrorBoundary} from './src/renderer/components/ErrorBoundary';
    window.store=useStore; window.errors=[];
    window.addEventListener('error', e=>{if(e.message !== 'ResizeObserver loop completed with undelivered notifications.')window.errors.push(e.message)});
    window.addEventListener('unhandledrejection', e=>window.errors.push(String(e.reason)));
    (async()=>{
      const info=await window.snailAPI.openFile(${JSON.stringify(filename)});
      useStore.getState().setFileInfo(info);
      useStore.setState({xAxisMode:'time',powerMin:-78,powerMax:-12});
      createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);
    })();
  `,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}}).outputFiles[0].text
  const css=fs.readFileSync(path.join(root,'src/renderer/styles/global.css'),'utf8').split('\n').filter(line=>!line.startsWith('@import')).join('\n')
  fs.writeFileSync(path.join(temporary,'index.html'),`<html><head><style>${css}</style></head><body><div id="root"></div><script>${bundle.replace(/<\/script/gi,'<\\/script')}</script></body></html>`)
  const win=new BrowserWindow({width:1680,height:1120,show:false,webPreferences:{preload:path.join(root,'out/preload/index.js'),offscreen:true,backgroundThrottling:false}})
  const js=script=>win.webContents.executeJavaScript(script)
  await win.loadFile(path.join(temporary,'index.html'))
  const until=async(predicate)=>{for(let i=0;i<100;i++){if(await js(predicate))return;await pause(100)}throw new Error('Timed out: '+predicate)}
  await until('window.store?.getState().viewWidth > 0 && !!window.store.getState().eventProject')
  const fit=async()=>{await js(`window.store.getState().setZoomLevel(512*window.store.getState().viewWidth/512000);window.store.getState().setScrollOffset(0)`);await pause(600)}
  const save=async name=>{
    await pause(350)
    assert.deepEqual(await js('window.errors'),[])
    assert.equal(await js(`document.getElementById('root').textContent.includes('Something went wrong')`),false)
    const destination=path.join(root,'pics/features');fs.mkdirSync(destination,{recursive:true})
    fs.writeFileSync(path.join(destination,name+'.jpg'),(await win.webContents.capturePage()).toJPEG(90))
    console.log('Captured '+name+'.jpg')
  }
  const click=async label=>{await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await pause(120)}
  const select=async(label,value)=>{await js(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(80)}
  const input=async(label,value)=>{await js(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(80)}
  await fit()
  // Physical cursor selection around one known FSK-like fixture burst.
  await js(`window.store.getState().focusProposal({id:'inspection',sampleStart:25600,sampleCount:24320,freqLowerEdge:48000,freqUpperEdge:56000})`)
  await fit()
  await save('overview')
  await click('Detect & label')
  await fit()
  await select('Scan range','recording')
  await select('Power threshold mode','absolute')
  await input('Absolute threshold (dB)','-40')
  await click('Find transmissions')
  await until(`window.store.getState().detectionProgress?.status==='complete'`)
  const proposals=await js('window.store.getState().eventProject.proposals')
  assert.ok(proposals.length>5,'Synthetic fixture should produce multiple candidates')
  await js(`window.store.getState().setCursorsEnabled(false)`)
  await save('detection')
  // Accept actual detector results using the production review IPC.
  await js(`(async()=>{
    const state=window.store.getState();const id=state.fileInfo.recordingId;
    const candidates=state.eventProject.proposals.slice(0,6);
    for(const event of candidates){
      const center=(event.freqLowerEdge+event.freqUpperEdge)/2;
      const label=center<-80000?'Pulsed carrier':center<0?'Linear chirp':center>40000?'FSK-like burst':'Hopping tone';
      const result=await window.snailAPI.reviewProposal({recordingId:id,proposalId:event.id,expectedRevision:event.revision,action:'accept',frequencyMode:'rf',patch:{...event,label,comment:'Reviewed synthetic documentation fixture'}});
      state.applyDetectionState({recordingId:id,project:result.project,progress:state.detectionProgress});
      state.setSigmfMetadata(result.sigmfMetaJson);
    }
  })()`)
  await select('Review filter','accepted')
  await select('Dataset contents','channelized')
  await js(`document.querySelector('[aria-label="Dataset export"]').scrollIntoView({block:'end'})`)
  await save('dataset')
  // Dedicated analysis windows use the built production renderer/preload and real native IPC.
  const { IPC } = require('../src/shared/ipc-channels.ts')
  const analysisShot = async (kind, range, ready) => {
    const analysis = new BrowserWindow({width:1100,height:820,show:false,backgroundColor:'#0a0e14',webPreferences:{
      preload:path.join(root,'out/preload/index.js'),offscreen:true,backgroundThrottling:false}})
    await analysis.loadFile(path.join(root,'out/renderer/index.html'),{query:{window:kind}})
    await pause(250)
    analysis.webContents.send(kind==='fft'?IPC.FFT_WINDOW_UPDATE:IPC.CONSTELLATION_WINDOW_UPDATE,range)
    let loaded=false
    for(let i=0;i<80;i++) {
      if(await analysis.webContents.executeJavaScript(ready)){loaded=true;break}
      await pause(100)
    }
    assert.ok(loaded,kind+' must receive and process actual samples')
    if(kind==='fft') await analysis.webContents.executeJavaScript(`document.querySelector('input[type="checkbox"]').click()`)
    await pause(350)
    fs.writeFileSync(path.join(root,'pics/features',kind+'.jpg'),(await analysis.webContents.capturePage()).toJPEG(90))
    console.log('Captured '+kind+'.jpg')
    analysis.destroy()
  }
  const sourceId=await js('window.store.getState().fileInfo.recordingId')
  await analysisShot('fft',{recordingId:sourceId,start:25600,length:24320,fs:256000},`document.body.textContent.includes('Max:')`)
  // A second generated fixture produces a recognizable four-cluster constellation.
  const qpskPath=path.join(temporary,'synthetic-qpsk.sigmf-data')
  const qpsk=Buffer.alloc(32768*8)
  let rng=73, real=0, imag=0
  const next=()=>{rng=(1664525*rng+1013904223)>>>0;return rng/4294967296}
  for(let n=0;n<32768;n++) {
    if(n%16===0){real=next()<.5?-.45:.45;imag=next()<.5?-.45:.45}
    qpsk.writeFloatLE(real+(next()+next()+next()-1.5)*.065,n*8)
    qpsk.writeFloatLE(imag+(next()+next()+next()-1.5)*.065,n*8+4)
  }
  fs.writeFileSync(qpskPath,qpsk)
  fs.writeFileSync(qpskPath.replace('.sigmf-data','.sigmf-meta'),JSON.stringify({global:{'core:datatype':'cf32_le','core:sample_rate':256000,'core:version':'1.2.5'},captures:[{'core:sample_start':0,'core:frequency':433920000}],annotations:[]}))
  const qpskInfo=await js(`(async()=>{const info=await window.snailAPI.openFile(${JSON.stringify(qpskPath)});window.store.getState().setFileInfo(info);return info})()`)
  await analysisShot('constellation',{recordingId:qpskInfo.recordingId,start:0,length:32768,fs:256000},`document.body.textContent.includes('32,768')`)
  win.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(0)
}).catch(error=>{console.error(error);console.error('Temporary artifacts:',temporary);app.exit(1)})
