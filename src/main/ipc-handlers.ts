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
  // In development, the path depends on where the main process is running from
  const devPath = path.resolve(__dirname, '../../src/native/build/Release/snail_native.node')

  const searchPaths = isPackaged
    ? [prodPath]
    : [devPath, path.join(__dirname, '../native/snail_native.node')]

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

export function registerIpcHandlers(): void {
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
    return addon.openFile(String(filePath), String(format || ''), opts ?? {})
  })

  ipcMain.handle(IPC.GET_SAMPLES, async (_event, start: number, length: number, stride: number = 1) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.getSamples(start, length, stride || 1)
  })

  ipcMain.handle(IPC.COMPUTE_FFT_TILE, async (_event, req: FFTTileRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.computeFFTTile(req.startSample, req.fftSize, req.stride)
  })

  ipcMain.handle(IPC.EXPORT_SIGMF, async (_event, config: ExportConfig) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.exportSigMF(config)
  })

  ipcMain.handle(IPC.READ_FILE_SAMPLES, async (_event, path: string, format: string, start: number, length: number) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.readFileSamples(path, format, start, length)
  })

  ipcMain.handle(IPC.CORRELATE, async (_event, req: CorrelateRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.correlate(req)
  })

  ipcMain.handle(IPC.COMPUTE_FFT, async (_event, req: any) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.computeFFT(req)
  })

  ipcMain.handle(IPC.EXTRACT_FEATURES, async (_event, req: { startSample: number; sampleCount: number; frameSize?: number }) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.extractFeatures(req)
  })

  ipcMain.handle(IPC.EXPORT_FEATURES, async (_event, data: { features: Float32Array; labels: string[]; frameSize: number; appendToPath?: string }) => {
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

  ipcMain.handle(IPC.CLASSIFY_REGION, async (_event, req: { startSample: number; sampleCount: number; frameSize?: number }): Promise<ClassificationResult[]> => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.classifyRegion(req)
  })

  ipcMain.handle(IPC.FIND_PULSES, async (_event, req: PulseFindRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.findPulses(req)
  })

  ipcMain.handle(IPC.SAVE_ANNOTATION, async (_event, filePath: string, annotation: SigMFAnnotation) => {
    // Determine the .sigmf-meta path
    let metaPath: string
    if (filePath.endsWith('.sigmf-data')) {
      metaPath = filePath.replace(/\.sigmf-data$/, '.sigmf-meta')
    } else {
      metaPath = filePath + '.sigmf-meta'
    }

    // Read existing meta or create skeleton
    let meta: any
    try {
      const content = fs.readFileSync(metaPath, 'utf-8')
      meta = JSON.parse(content)
    } catch {
      meta = {
        'global': {
          'core:datatype': 'cf32_le',
          'core:version': '1.0.0'
        },
        'captures': [],
        'annotations': []
      }
    }

    if (!Array.isArray(meta.annotations)) {
      meta.annotations = []
    }

    // Build the SigMF annotation object
    const sigAnn: Record<string, unknown> = {
      'core:sample_start': annotation.sampleStart,
      'core:sample_count': annotation.sampleCount
    }
    if (annotation.freqLowerEdge != null) {
      sigAnn['core:freq_lower_edge'] = annotation.freqLowerEdge
    }
    if (annotation.freqUpperEdge != null) {
      sigAnn['core:freq_upper_edge'] = annotation.freqUpperEdge
    }
    if (annotation.label) {
      sigAnn['core:label'] = annotation.label
    }
    if (annotation.comment) {
      sigAnn['core:comment'] = annotation.comment
    }

    meta.annotations.push(sigAnn)
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return { success: true }
  })
}
