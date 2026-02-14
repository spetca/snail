/**
 * LRU cache for WebGL tile textures.
 * Keyed by "{sampleOffset}_{fftSize}_{zoomLevel}".
 */

interface CacheEntry {
  texture: WebGLTexture
  numRows: number
  lastUsed: number
}

const MAX_TILES = 256

export class TileCache {
  private cache = new Map<string, CacheEntry>()
  private gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  size(): number {
    return this.cache.size
  }

  get(key: string): { texture: WebGLTexture; numRows: number } | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    entry.lastUsed = Date.now()
    return { texture: entry.texture, numRows: entry.numRows }
  }

  put(key: string, texture: WebGLTexture, numRows: number): void {
    this.evictIfNeeded()
    this.cache.set(key, { texture, numRows, lastUsed: Date.now() })
  }

  private evictIfNeeded(): void {
    if (this.cache.size < MAX_TILES) return

    // Find oldest entry
    let oldestKey = ''
    let oldestTime = Infinity
    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!
      this.gl.deleteTexture(entry.texture)
      this.cache.delete(oldestKey)
    }
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      this.gl.deleteTexture(entry.texture)
    }
    this.cache.clear()
  }
}
