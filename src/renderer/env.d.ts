/// <reference types="vite/client" />

import type { SnailAPI } from '../preload/index'

declare global {
  interface Window {
    snailAPI: SnailAPI
  }
}

// Electron's draggable window regions extend standard CSS.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
