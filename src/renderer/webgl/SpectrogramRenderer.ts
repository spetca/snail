import { fftTile } from '../dsp/fft-tiles'
import { TileCache } from './TileCache'
import { generateColorMap } from './ColorMap'
import { GpuFFT, makeProgram } from './GpuFFT'
import type { FFTTileRequest } from '../../shared/sample-formats'

export const TILE_LINES = 256
const vertex = `#version 300 es
uniform vec2 u_bounds;
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  gl_Position = vec4(mix(u_bounds.x, u_bounds.y, p.x), p.y * 2.0 - 1.0, 0.0, 1.0);
  v_uv = vec2(p.x, 1.0 - p.y);
}`
const fragment = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tile;
uniform sampler2D u_colormap;
uniform vec2 u_power;
uniform vec2 u_y;
out vec4 color;
void main() {
  float frequency = u_y.y + v_uv.y / u_y.x;
  if (frequency < 0.0 || frequency > 1.0) { color = vec4(0.02, 0.035, 0.06, 1.0); return; }
  float power = texture(u_tile, vec2(1.0 - frequency, v_uv.x)).r;
  float normalized = clamp((power - u_power.x) / max(0.001, u_power.y - u_power.x), 0.0, 1.0);
  color = texture(u_colormap, vec2(normalized, 0.5));
}`
export interface RenderParams {
  scrollOffset: number; fftSize: number; stride: number; powerMin: number; powerMax: number
  totalSamples: number; yZoomLevel?: number; yScrollOffset?: number
}

export class SpectrogramRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private tileCache: TileCache
  private colormap: WebGLTexture
  private vao: WebGLVertexArrayObject
  private gpu: GpuFFT | null = null
  private backend = new Map<number, { cpuMs: number; gpu?: boolean }>()
  private width = 0
  private height = 0
  private disposed = false
  private maxTexture: number
  private bounds: WebGLUniformLocation | null
  private power: WebGLUniformLocation | null
  private y: WebGLUniformLocation | null

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    this.tileCache = new TileCache(gl)
    this.program = makeProgram(gl, vertex, fragment)
    this.vao = gl.createVertexArray()!
    this.bounds = gl.getUniformLocation(this.program, 'u_bounds')
    this.power = gl.getUniformLocation(this.program, 'u_power')
    this.y = gl.getUniformLocation(this.program, 'u_y')
    gl.useProgram(this.program)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_tile'), 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_colormap'), 1)
    this.colormap = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.colormap)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, generateColorMap('plasma-dark'))
    this.filter()
    gl.clearColor(0.02, 0.035, 0.06, 1)
    // A small real numerical check catches broken/unsupported float render targets.
    try { this.gpu = new GpuFFT(gl); this.gpu.verify() }
    catch { this.gpu?.dispose(); this.gpu = null }
  }

  private filter(): void {
    const gl = this.gl
    // Half-float filtering is core WebGL2; R32F linear filtering is not.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  resize(width: number, height: number): void { this.width = width; this.height = height }
  hasTile(key: string): boolean { return this.tileCache.has(key) }

  /** The first tile establishes CPU cost; one following tile measures the complete GPU path including IPC. */
  async loadTile(key: string, req: FFTTileRequest): Promise<void> {
    const baseline = this.backend.get(req.fftSize)
    if (this.gpu?.supports(req.fftSize) && baseline && baseline.gpu !== false && window.snailAPI.readFFTTile) {
      const gpu = this.gpu
      const started = performance.now()
      let texture: WebGLTexture | null = null
      try {
        const samples = await window.snailAPI.readFFTTile(req)
        if (this.disposed) return
        texture = gpu.compute(samples, req.fftSize)
        const rows = samples.length / (req.fftSize * 2)
        // Timing is needed only once per FFT size/context. Normal rendering never reads back or waits.
        if (baseline.gpu === undefined) {
          baseline.gpu = true
          await gpu.finished()
          baseline.gpu = performance.now() - started < Math.max(2, baseline.cpuMs * 1.1)
        }
        if (this.disposed) { this.gl.deleteTexture(texture); return }
        this.gl.activeTexture(this.gl.TEXTURE0); this.gl.bindTexture(this.gl.TEXTURE_2D, texture); this.filter()
        this.tileCache.put(key, texture, rows, req.fftSize * rows * 2)
        return
      } catch {
        if (texture) this.gl.deleteTexture(texture)
        baseline.gpu = false
        if (this.disposed || this.gl.isContextLost()) return
      }
    }
    const started = performance.now()
    const data = await fftTile(req)
    if (this.disposed) return
    this.uploadTile(key, data, req.fftSize)
    if (!baseline) this.backend.set(req.fftSize, { cpuMs: performance.now() - started })
  }

  uploadTile(key: string, data: Float32Array, fftSize: number): void {
    const gl = this.gl, rows = Math.floor(data.length / fftSize)
    if (this.disposed || rows < 1) return
    const bins = Math.min(fftSize, this.maxTexture)
    let display = data
    if (bins !== fftSize) {
      // Fit GPUs with smaller texture limits while preserving narrow peaks in the display.
      display = new Float32Array(rows * bins)
      const group = fftSize / bins
      for (let row = 0; row < rows; ++row) for (let bin = 0; bin < bins; ++bin) {
        let peak = -Infinity
        for (let k = 0; k < group; ++k) peak = Math.max(peak, data[row * fftSize + bin * group + k])
        display[row * bins + bin] = peak
      }
    }
    const texture = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, bins, rows)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bins, rows, gl.RED, gl.FLOAT, display)
    this.filter()
    if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(texture); throw new Error('Cannot upload spectrogram texture') }
    this.tileCache.put(key, texture, rows, bins * rows * 2)
  }

  render(params: RenderParams): void {
    const gl = this.gl
    if (this.disposed || gl.isContextLost() || !this.width || !this.height) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, this.width, this.height)
    gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program)
    gl.uniform2f(this.power, params.powerMin, params.powerMax)
    gl.uniform2f(this.y, params.yZoomLevel ?? 1, params.yScrollOffset ?? 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.colormap)
    const coverage = TILE_LINES * params.stride
    const width = this.width / (window.devicePixelRatio || 1)
    const end = params.scrollOffset + width * params.stride
    for (let i = Math.floor(params.scrollOffset / coverage); i < Math.ceil(end / coverage); ++i) {
      const start = i * coverage
      const tile = this.tileCache.get(`${start}_${params.fftSize}_${params.stride}`)
      if (!tile) continue
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tile.texture)
      const x0 = (start - params.scrollOffset) / (params.stride * width) * 2 - 1
      const x1 = (start + tile.numRows * params.stride - params.scrollOffset) / (params.stride * width) * 2 - 1
      gl.uniform2f(this.bounds, x0, x1)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gl.bindVertexArray(null)
  }
  clearTiles(): void { this.tileCache.clear() }
  dispose(): void {
    this.disposed = true
    this.tileCache.clear(); this.gpu?.dispose()
    this.gl.deleteTexture(this.colormap); this.gl.deleteProgram(this.program); this.gl.deleteVertexArray(this.vao)
  }
}
