import { ipcMain, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, SigMFAnnotation, FFTTileRequest, ExportConfig, CorrelateRequest } from '../shared/sample-formats'

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

  ipcMain.handle(IPC.OPEN_FILE, async (_event, filePath: string, format?: SampleFormat) => {
    const addon = loadNative()
    if (!addon) {
      throw new Error('Native addon not loaded')
    }
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Invalid file path: ' + typeof filePath)
    }
    return addon.openFile(String(filePath), String(format || ''))
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
