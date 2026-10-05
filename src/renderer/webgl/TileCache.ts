interface CacheEntry {
  texture: WebGLTexture
  numRows: number
  bytes: number
}

/** Byte-budgeted LRU. Map iteration is recency order, independent of clock resolution. */
export class TileCache {
  private cache = new Map<string, CacheEntry>()
  private bytes = 0
  constructor(private gl: WebGL2RenderingContext, readonly budgetBytes = 128 * 1024 * 1024) {}
  has(key: string): boolean { return this.cache.has(key) }
  size(): number { return this.cache.size }
  byteSize(): number { return this.bytes }
  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    this.cache.delete(key); this.cache.set(key, entry)
    return entry
  }
  put(key: string, texture: WebGLTexture, numRows: number, bytes: number): void {
    this.remove(key)
    if (bytes > this.budgetBytes) { this.gl.deleteTexture(texture); throw new Error('Display tile exceeds GPU cache budget') }
    while (this.bytes + bytes > this.budgetBytes && this.cache.size) this.remove(this.cache.keys().next().value!)
    this.cache.set(key, { texture, numRows, bytes }); this.bytes += bytes
  }
  private remove(key: string): void {
    const entry = this.cache.get(key)
    if (entry) { this.gl.deleteTexture(entry.texture); this.bytes -= entry.bytes; this.cache.delete(key) }
  }
  clear(): void { for (const key of this.cache.keys()) this.remove(key) }
}
