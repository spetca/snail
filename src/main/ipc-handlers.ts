import { DatasetExporter } from './dataset/exporter'
import type { DatasetRequest } from '../shared/dataset'
import { EventProjects } from './detection/event-projects'
import type { StartDetectionRequest, ReviewProposalRequest } from '../shared/detection'
import { metadataPaths, saveAnnotationMetadata } from './annotation-metadata'
import type { AnnotationFrequencyMode } from '../shared/sigmf'
import { RecordingSession } from './recording-session'
import { ipcMain, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, SigMFAnnotation, FFTTileRequest, ExportConfig, CorrelateRequest, ClassificationResult, PulseFindRequest } from '../shared/sample-formats'
import { FORMAT_EXTENSIONS, SAMPLE_BYTE_SIZES } from '../shared/sample-formats'

// Native addon will be loaded when built
let native: any = null

function loadNative(): any {
  if (native) return native

  const isPackaged = app.isPackaged
  const prodPath = path.join(process.resourcesPath, 'native', 'snail_native.node')
  // __dirname = out/main/ in both dev and preview; cwd() = project root in dev
  const devPath = path.resolve(__dirname, '../../src/native/build/Release/snail_native.node')
  const cwdPath = path.resolve(process.cwd(), 'src/native/build/Release/snail_native.node')

  const searchPaths = isPackaged
    ? [prodPath]
    : [devPath, cwdPath, path.join(__dirname, '../native/snail_native.node')]

  for (const p of searchPaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`Loading native addon from: ${p}`)
        native = require(p)
        return native
      } else {
        console.warn(`Native addon not found at: ${p}`)
      }
    } catch (e) {
      console.error(`Failed to load native addon from ${p}:`, e)
    }
  }

  // Fallback for dev environment structures
  try {
    native = require('../../src/native/build/Release/snail_native.node')
    return native
  } catch {
    console.warn('Native addon not available at searched paths')
    return null
  }
}

export const recordingSession = new RecordingSession()

export function registerIpcHandlers(onRecordingOpened: () => void = () => {}): void {
  const events = new EventProjects(path.join(app.getPath('userData'), 'event-projects'), recordingSession,
    (start, fftSize, stride, end) => {
      const addon = loadNative()
      if (!addon) throw new Error('Native addon not loaded')
      return addon.computeFFTTile(start, fftSize, stride, end)
    })
  const datasets = new DatasetExporter(recordingSession, (start, count) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.getSamples(start, count, 1)
  })
  ipcMain.handle(IPC.DATASET_STATE, (_event, id: string) => datasets.state(id))
  ipcMain.handle(IPC.CANCEL_DATASET, (_event, id: string, jobId: string) => datasets.cancel(id, jobId))
  ipcMain.handle(IPC.EXPORT_DATASET, async (_event, request: DatasetRequest) => {
    recordingSession.assertCurrent(request.recordingId)
    const result = await dialog.showOpenDialog({ title: 'Choose a folder for the accepted-event dataset', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    // Revalidate after the native dialog: the user may have switched files or edited the queue.
    const state = events.state(request.recordingId)
    if (!state.project || state.project.revision !== request.expectedRevision) throw new Error('Review project changed; reload and export again')
    return datasets.start(request.recordingId, state.project, request.mode, result.filePaths[0])
  })
  ipcMain.handle(IPC.DETECTION_STATE, (_event, id: string, knownRevision?: number) => events.state(id, knownRevision))
  ipcMain.handle(IPC.START_DETECTION, (_event, request: StartDetectionRequest) => events.start(request))
  ipcMain.handle(IPC.CANCEL_DETECTION, (_event, id: string, runId: string) => events.cancel(id, runId))
  ipcMain.handle(IPC.RESET_DETECTION, (_event, id: string, revision: number) => events.reset(id, revision))
  ipcMain.handle(IPC.REVIEW_PROPOSAL, (_event, request: ReviewProposalRequest) => events.review(request))

  ipcMain.handle(IPC.SHOW_OPEN_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'IQ Files',
          extensions: [
            'cf32', 'fc32', 'cfile', 'raw', 'iq',
            'cf64', 'cs32', 'cs16', 'sc16', 'cs8', 'sc8', 'cu8',
            'sigmf-data', 'sigmf-meta',
            'rf32', 'rf64', 'rs16', 'rs8', 'ru8'
          ]
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SHOW_SAVE_DIALOG, async (_event, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [
        { name: 'SigMF Data', extensions: ['sigmf-data'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    // Strip extension — exportSigMF appends .sigmf-data and .sigmf-meta
    return result.filePath.replace(/\.(sigmf-data|sigmf-meta)$/, '')
  })

  ipcMain.handle(IPC.PROBE_FILE, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Invalid file path')

    const stat = fs.statSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const format: SampleFormat = (FORMAT_EXTENSIONS[ext] ?? 'cf32') as SampleFormat
    const sampleBytes = SAMPLE_BYTE_SIZES[format]
    const totalSamples = Math.floor(stat.size / sampleBytes)

    let sampleRate = 1000000
    let centerFrequency: number | undefined

    // For SigMF files, parse meta to get sample rate and center frequency
    const metaPath = filePath.replace(/\.sigmf-data$/, '.sigmf-meta')
    if ((filePath.endsWith('.sigmf-data') || filePath.endsWith('.sigmf-meta')) && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (meta?.global?.['core:sample_rate']) sampleRate = meta.global['core:sample_rate']
        if (meta?.captures?.[0]?.['core:frequency']) centerFrequency = meta.captures[0]['core:frequency']
      } catch { /* use defaults */ }
    }

    return { totalSamples, sampleRate, format, fileSize: stat.size, centerFrequency }
  })

  ipcMain.handle(IPC.OPEN_FILE, async (_event, filePath: string, format?: SampleFormat, opts?: { viewStart?: number; viewLength?: number }) => {
    const addon = loadNative()
    if (!addon) {
      throw new Error('Native addon not loaded')
    }
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Invalid file path: ' + typeof filePath)
    }
    // Read sidecar errors before publishing a different native source/session.
    const metaPath = metadataPaths(filePath).meta
    const sidecar = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : undefined
    const info = recordingSession.open(() => ({
      ...addon.openFile(String(filePath), String(format || ''), opts ?? {}),
      ...(sidecar ? { sigmfMetaJson: sidecar } : {})
    }))
    onRecordingOpened()
    return info
  })

  ipcMain.handle(IPC.GET_SAMPLES, async (_event, start: number, length: number, stride: number = 1, recordingId: string) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(recordingId, () => addon.getSamples(start, length, stride || 1))
  })

  ipcMain.handle(IPC.COMPUTE_FFT_TILE, async (_event, req: FFTTileRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.computeFFTTile(req.startSample, req.fftSize, req.stride))
  })

  ipcMain.handle(IPC.EXPORT_SIGMF, async (_event, config: ExportConfig) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(config.recordingId, () => addon.exportSigMF(config))
  })

  ipcMain.handle(IPC.READ_FILE_SAMPLES, async (_event, path: string, format: string, start: number, length: number) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.readFileSamples(path, format, start, length)
  })

  ipcMain.handle(IPC.CORRELATE, async (_event, req: CorrelateRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.correlate(req))
  })

  ipcMain.handle(IPC.COMPUTE_FFT, async (_event, req: any) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.computeFFT(req))
  })

  ipcMain.handle(IPC.EXTRACT_FEATURES, async (_event, req: { recordingId: string; startSample: number; sampleCount: number; frameSize?: number }) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.extractFeatures(req))
  })

  ipcMain.handle(IPC.EXPORT_FEATURES, async (_event, data: { recordingId: string; features: Float32Array; labels: string[]; frameSize: number; appendToPath?: string }) => {
    recordingSession.assertCurrent(data.recordingId)
    let filePath: string
    if (data.appendToPath) {
      // Already have a path — append silently, no dialog
      filePath = data.appendToPath
    } else {
      const result = await dialog.showSaveDialog({
        defaultPath: 'features.json',
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      filePath = result.filePath
    }

    recordingSession.assertCurrent(data.recordingId)
    const FEATURE_NAMES = [
      'sigma_a', 'mu_42', 'sigma_dp', 'sigma_af',
      'C20', 'C21', 'C40', 'C41', 'C42',
      'gamma_max', 'sp_centroid', 'sp_bandwidth', 'sp_flatness', 'sp_rolloff', 'sp_symmetry'
    ]

    const frameCount = data.labels.length
    const nFeatures = frameCount > 0 ? data.features.length / frameCount : 0
    const featArray = Array.from(data.features)
    const newFrames: number[][] = []
    for (let i = 0; i < frameCount; ++i) {
      newFrames.push(featArray.slice(i * nFeatures, (i + 1) * nFeatures))
    }
    const newLabels = data.labels

    // If the file already exists, merge new frames into it
    let existingFrames: number[][] = []
    let existingLabels: string[] = []
    if (fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (Array.isArray(existing.features) && Array.isArray(existing.labels)) {
          existingFrames = existing.features
          existingLabels = existing.labels
        }
      } catch { /* ignore corrupt file, overwrite */ }
    }

    const mergedFrames = [...existingFrames, ...newFrames]
    const mergedLabels = [...existingLabels, ...newLabels]

    const payload = {
      frameCount: mergedFrames.length,
      nFeatures,
      frameSize: data.frameSize,
      featureNames: FEATURE_NAMES,
      labels: mergedLabels,
      features: mergedFrames
    }

    const classBreakdown: Record<string, number> = {}
    for (const lbl of mergedLabels) classBreakdown[lbl] = (classBreakdown[lbl] ?? 0) + 1

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    const appended = existingLabels.length > 0
    return { success: true, path: filePath, appended, totalFrames: mergedFrames.length, classBreakdown }
  })

  ipcMain.handle(IPC.SHOW_OPEN_JSON_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.TRAIN_CLASSIFIER, async (_event, featuresPath: string) => {
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'train_classifier.py')
      : path.join(app.getAppPath(), 'scripts', 'train_classifier.py')

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `Script not found: ${scriptPath}` }
    }

    const outDir = path.dirname(featuresPath)
    const modelPath = path.join(outDir, 'model.json')
    const venvDir = path.join(app.getPath('userData'), 'classifier-venv')
    const isWin = process.platform === 'win32'
    const venvPython = path.join(venvDir, isWin ? 'Scripts/python.exe' : 'bin/python3')

    // Helper: run a command and return { ok, stderr }
    function run(cmd: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
      return new Promise((resolve) => {
        const proc = spawn(cmd, args, { stdio: 'pipe' })
        let stderr = ''
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('error', (e: Error) => resolve({ ok: false, stderr: e.message }))
        proc.on('close', (code: number | null) => resolve({ ok: code === 0, stderr: stderr.trim() }))
      })
    }

    // Find a working python3/python
    async function findPython(): Promise<string | null> {
      for (const cmd of ['python3', 'python']) {
        const r = await run(cmd, ['--version'])
        if (r.ok) return cmd
      }
      return null
    }

    // 1. Ensure venv exists
    if (!fs.existsSync(venvPython)) {
      const basePython = await findPython()
      if (!basePython) {
        return { success: false, error: 'Python not found. Install python3 via brew or python.org.' }
      }
      const r = await run(basePython, ['-m', 'venv', venvDir])
      if (!r.ok) return { success: false, error: `Failed to create venv: ${r.stderr}` }
    }

    // 2. Install deps into venv (no-op if already installed)
    const installR = await run(venvPython, [
      '-m', 'pip', 'install', 'numpy', 'scikit-learn', 'matplotlib', '--quiet'
    ])
    if (!installR.ok) return { success: false, error: `pip install failed: ${installR.stderr}` }

    // 3. Run training script
    const trainR = await run(venvPython, [scriptPath, featuresPath, '--no-plot', '--output-dir', outDir])
    if (!trainR.ok) return { success: false, error: trainR.stderr || 'Training failed' }

    return { success: true, modelPath }
  })

  ipcMain.handle(IPC.LOAD_CLASSIFIER, async (_event, modelPath: string) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.loadClassifier(modelPath)
  })

  ipcMain.handle(IPC.CLASSIFY_REGION, async (_event, req: { recordingId: string; startSample: number; sampleCount: number; frameSize?: number }): Promise<ClassificationResult[]> => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.classifyRegion(req))
  })

  ipcMain.handle(IPC.FIND_PULSES, async (_event, req: PulseFindRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return recordingSession.run(req.recordingId, () => addon.findPulses(req))
  })

  ipcMain.handle(IPC.SAVE_ANNOTATION, async (_event, filePath: string, annotation: SigMFAnnotation, recordingId: string, mode: AnnotationFrequencyMode, sampleRate: number) => {
    const current = recordingSession.assertCurrent(recordingId)
    if (filePath !== current.path) throw new Error('Annotation belongs to a different recording')
    if (mode !== 'rf' && mode !== 'legacy-baseband') throw new Error('Invalid annotation frequency mode')
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate')
    return { success: true, sigmfMetaJson: saveAnnotationMetadata({ ...current, sampleRate }, annotation, mode) }
  })
}
