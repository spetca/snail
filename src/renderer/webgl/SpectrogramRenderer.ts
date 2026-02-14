import { TileCache } from './TileCache'
import { generateColorMap } from './ColorMap'

export const TILE_LINES = 256

const vertShaderSrc = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`

// The tile texture is laid out as:
//   width  = fftSize (frequency bins)
//   height = numLines (time steps)
// On screen we want:
//   X axis = time  -> sample from texture Y
//   Y axis = freq  -> sample from texture X
// So we swap: texCoord.x is screen-X (time) -> texture row (Y)
//             texCoord.y is screen-Y (freq) -> texture col (X)
const fragShaderSrc = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_tile;
uniform sampler2D u_colormap;
uniform float u_powerMin;
uniform float u_powerMax;
void main() {
  // v_texCoord.x = normalized time position within tile (0=first line, 1=last line)
  // v_texCoord.y = normalized frequency (0=top of screen=high freq, 1=bottom=low freq)
  // Texture: X=freq bin, Y=time line
  // Flip freq so 0=bottom freq bin (low), 1=top (high) -> screen top should be high freq
  vec2 tileUV = vec2(1.0 - v_texCoord.y, v_texCoord.x);
  float power = texture2D(u_tile, tileUV).r;
  // Map: powerMin -> 0 (dark), powerMax -> 1 (bright)
  float normalized = (power - u_powerMin) / (u_powerMax - u_powerMin);
  normalized = clamp(normalized, 0.0, 1.0);
  vec4 color = texture2D(u_colormap, vec2(normalized, 0.5));
  gl_FragColor = color;
}
`

export interface RenderParams {
  scrollOffset: number
  fftSize: number
  zoomLevel: number
  powerMin: number
  powerMax: number
  totalSamples: number
}

export class SpectrogramRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private tileCache: TileCache
  private colormapTexture: WebGLTexture | null = null
  private posBuffer: WebGLBuffer | null = null
  private texBuffer: WebGLBuffer | null = null
  private width = 0
  private height = 0
  private canFilterFloat = false

  private aPos = -1
  private aTex = -1
  private uTile: WebGLUniformLocation | null = null
  private uColormap: WebGLUniformLocation | null = null
  private uPowerMin: WebGLUniformLocation | null = null
  private uPowerMax: WebGLUniformLocation | null = null

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl
    // R32F textures require this extension for LINEAR filtering; without it sampling returns 0
    this.canFilterFloat = !!gl.getExtension('OES_texture_float_linear')
    this.tileCache = new TileCache(gl)
    this.init()
  }

  private init(): void {
    const gl = this.gl

    const vert = this.compileShader(gl.VERTEX_SHADER, vertShaderSrc)
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragShaderSrc)

    this.program = gl.createProgram()!
    gl.attachShader(this.program, vert)
    gl.attachShader(this.program, frag)
    gl.linkProgram(this.program)

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Shader link failed:', gl.getProgramInfoLog(this.program))
      return
    }

    gl.useProgram(this.program)

    this.aPos = gl.getAttribLocation(this.program, 'a_position')
    this.aTex = gl.getAttribLocation(this.program, 'a_texCoord')
    this.uTile = gl.getUniformLocation(this.program, 'u_tile')
    this.uColormap = gl.getUniformLocation(this.program, 'u_colormap')
    this.uPowerMin = gl.getUniformLocation(this.program, 'u_powerMin')
    this.uPowerMax = gl.getUniformLocation(this.program, 'u_powerMax')

    this.posBuffer = gl.createBuffer()!
    this.texBuffer = gl.createBuffer()!

    this.colormapTexture = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    const cmData = generateColorMap('plasma-dark')
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cmData)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.clearColor(0.02, 0.035, 0.06, 1.0)
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile failed:', gl.getShaderInfoLog(shader))
    }
    return shader
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.gl.viewport(0, 0, width, height)
  }

  hasTile(key: string): boolean {
    return this.tileCache.has(key)
  }

  uploadTile(key: string, data: Float32Array, fftSize: number): void {
    const gl = this.gl
    // Ensure we have a real Float32Array (IPC may deliver a different typed array)
    const floatData = data instanceof Float32Array ? data : new Float32Array(data)
    const numRows = Math.floor(floatData.length / fftSize)
    if (numRows < 1) return

    const texture = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)

    // Texture layout: width=fftSize (freq bins), height=numRows (time lines)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F,
      fftSize, numRows, 0,
      gl.RED, gl.FLOAT, floatData
    )
    // R32F textures need OES_texture_float_linear for LINEAR; fall back to NEAREST
    const filter = this.canFilterFloat ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.tileCache.put(key, texture, numRows)
  }

  render(params: RenderParams): void {
    const gl = this.gl
    if (!this.program) return

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)

    gl.uniform1f(this.uPowerMin, params.powerMin)
    gl.uniform1f(this.uPowerMax, params.powerMax)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    gl.uniform1i(this.uColormap, 1)

    const stride = params.fftSize / params.zoomLevel
    const tileSampleCoverage = TILE_LINES * stride
    const samplesPerPixel = stride
    const dpr = window.devicePixelRatio || 1
    const viewWidthPx = this.width / dpr
    const totalViewSamples = viewWidthPx * samplesPerPixel

    const visibleStart = params.scrollOffset
    const visibleEnd = visibleStart + totalViewSamples

    const firstTileIdx = Math.floor(visibleStart / tileSampleCoverage)
    const lastTileIdx = Math.ceil(visibleEnd / tileSampleCoverage)

    for (let tIdx = firstTileIdx; tIdx <= lastTileIdx; tIdx++) {
      const tileSampleStart = tIdx * tileSampleCoverage
      const tileKey = `${tileSampleStart}_${params.fftSize}_${params.zoomLevel}`
      const entry = this.tileCache.get(tileKey)
      if (!entry) continue

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.uniform1i(this.uTile, 0)

      // Use actual numRows to compute the real sample extent of this tile
      const actualTileEnd = tileSampleStart + entry.numRows * stride

      // Map tile sample range to pixel positions
      const tileStartPx = (tileSampleStart - visibleStart) / samplesPerPixel
      const tileEndPx = (actualTileEnd - visibleStart) / samplesPerPixel

      // Convert pixel coords to NDC (-1 to 1)
      const x0 = (tileStartPx / viewWidthPx) * 2.0 - 1.0
      const x1 = (tileEndPx / viewWidthPx) * 2.0 - 1.0

      // Positions: quad spanning [x0,x1] horizontally, full height vertically
      const positions = new Float32Array([
        x0, -1,  x1, -1,  x0, 1,
        x0,  1,  x1, -1,  x1, 1
      ])

      // texCoord: x=time within tile (0..1), y=frequency (0=top, 1=bottom)
      // The shader swaps these to sample the texture correctly
      const texCoords = new Float32Array([
        0, 1,  1, 1,  0, 0,
        0, 0,  1, 1,  1, 0
      ])

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(this.aPos)
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(this.aTex)
      gl.vertexAttribPointer(this.aTex, 2, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
  }

  dispose(): void {
    this.tileCache.clear()
    if (this.colormapTexture) this.gl.deleteTexture(this.colormapTexture)
    if (this.program) this.gl.deleteProgram(this.program)
  }
}
