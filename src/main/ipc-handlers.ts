import { ipcMain, dialog } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { SampleFormat, FFTTileRequest, ExportConfig, CorrelateRequest } from '../shared/sample-formats'

// Native addon will be loaded when built
let native: any = null

function loadNative(): any {
  if (native) return native
  try {
    native = require('../../src/native/build/Release/snail_native.node')
    return native
  } catch {
    console.warn('Native addon not available - using stub')
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

  ipcMain.handle(IPC.GET_SAMPLES, async (_event, start: number, length: number) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.getSamples(start, length)
  })

  ipcMain.handle(IPC.COMPUTE_FFT_TILE, async (_event, req: FFTTileRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.computeFFTTile(req.startSample, req.fftSize, req.zoomLevel)
  })

  ipcMain.handle(IPC.EXPORT_SIGMF, async (_event, config: ExportConfig) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.exportSigMF(config)
  })

  ipcMain.handle(IPC.CORRELATE, async (_event, req: CorrelateRequest) => {
    const addon = loadNative()
    if (!addon) throw new Error('Native addon not loaded')
    return addon.correlate(
      req.templateStart,
      req.templateLength,
      req.secondFilePath,
      req.secondFileFormat || ''
    )
  })
}
