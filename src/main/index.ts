import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { IPC } from '../shared/ipc-channels'

// Linux requires disabling the sandbox due to kernel unprivileged userns restrictions
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null
let fftWindow: BrowserWindow | null = null
let constellationWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0e14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    if (fftWindow) fftWindow.close()
    if (constellationWindow) constellationWindow.close()
  })
}

function createFFTWindow(): void {
  if (fftWindow) {
    fftWindow.focus()
    return
  }

  fftWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    backgroundColor: '#0a0e14',
    title: 'FFT Analysis',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  fftWindow.on('ready-to-show', () => {
    fftWindow?.show()
  })

  fftWindow.on('closed', () => {
    fftWindow = null
  })

  const fftUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}?window=fft`
    : `file://${join(__dirname, '../renderer/index.html')}?window=fft`

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    fftWindow.loadURL(fftUrl)
  } else {
    fftWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'fft' } })
  }
}

function createConstellationWindow(): void {
  if (constellationWindow) {
    constellationWindow.focus()
    return
  }

  constellationWindow = new BrowserWindow({
    width: 900,
    height: 900,
    backgroundColor: '#0a0e14',
    title: 'Constellation Analysis',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  constellationWindow.on('ready-to-show', () => {
    constellationWindow?.show()
  })

  constellationWindow.on('closed', () => {
    constellationWindow = null
  })

  const constUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}?window=constellation`
    : `file://${join(__dirname, '../renderer/index.html')}?window=constellation`

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    constellationWindow.loadURL(constUrl)
  } else {
    constellationWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'constellation' } })
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  ipcMain.on(IPC.OPEN_FFT_WINDOW, () => {
    createFFTWindow()
  })

  ipcMain.on(IPC.FFT_WINDOW_UPDATE, (_event: any, data: any) => {
    if (fftWindow) {
      fftWindow.webContents.send(IPC.FFT_WINDOW_UPDATE, data)
    }
  })

  ipcMain.on(IPC.OPEN_CONSTELLATION_WINDOW, () => {
    createConstellationWindow()
  })

  ipcMain.on(IPC.CONSTELLATION_WINDOW_UPDATE, (_event: any, data: any) => {
    if (constellationWindow) {
      constellationWindow.webContents.send(IPC.CONSTELLATION_WINDOW_UPDATE, data)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
