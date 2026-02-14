/// <reference types="vite/client" />

import type { SnailAPI } from '../preload/index'

declare global {
  interface Window {
    snailAPI: SnailAPI
  }
}
