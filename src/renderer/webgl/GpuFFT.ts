/** Vendor-neutral WebGL2 FFT. Only display tiles use this path; analysis/export retain float32 CPU DSP. */
const vertex = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_input;
uniform sampler2D u_lookup;
uniform int u_size;
uniform int u_stage;
uniform int u_logSize;
layout(location=0) out vec4 result;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int n = u_size;
  if (u_stage == 0) {
    vec4 lookup = texelFetch(u_lookup, ivec2(p.x, 0), 0);
    int reversed = int(lookup.a);
    result = vec4(texelFetch(u_input, ivec2(reversed, p.y), 0).rg * lookup.r, 0.0, 1.0);
  } else if (u_stage <= u_logSize) {
    int halfSize = 1 << (u_stage - 1);
    int blockSize = halfSize * 2;
    int j = p.x % halfSize;
    int base = (p.x / blockSize) * blockSize;
    vec2 a = texelFetch(u_input, ivec2(base + j, p.y), 0).rg;
    vec2 b = texelFetch(u_input, ivec2(base + j + halfSize, p.y), 0).rg;
    vec2 w = texelFetch(u_lookup, ivec2(j * (n / blockSize), 0), 0).gb;
    vec2 wb = vec2(w.x * b.x - w.y * b.y, w.x * b.y + w.y * b.x);
    result = vec4(a + (p.x % blockSize < halfSize ? wb : -wb), 0.0, 1.0);
  } else {
    vec2 value = texelFetch(u_input, ivec2(p.x ^ (n / 2), p.y), 0).rg / float(n);
    float power = 10.0 * log2(max(dot(value, value), 1e-20)) / log2(10.0);
    result = vec4(power, 0.0, 0.0, 1.0);
  }
}`

export function makeProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  if (!program) throw new Error('Cannot allocate GPU program')
  try {
    for (const [type, code] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Cannot allocate GPU shader')
      shaders.push(shader)
      gl.shaderSource(shader, code); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'GPU shader compilation failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'GPU program link failed')
    return program
  } catch (error) { gl.deleteProgram(program); throw error }
  finally { for (const shader of shaders) gl.deleteShader(shader) }
}

export class GpuFFT {
  private program: WebGLProgram
  private framebuffer: WebGLFramebuffer
  private vao: WebGLVertexArrayObject
  private scratch: WebGLTexture[] = []
  private lookup: WebGLTexture | null = null
  private lookupUniform: WebGLUniformLocation | null
  private size = 0
  private rows = 0
  private disposed = false
  private input: WebGLUniformLocation | null
  private n: WebGLUniformLocation | null
  private stage: WebGLUniformLocation | null
  private logSize: WebGLUniformLocation | null
  readonly maxSize: number

  constructor(private gl: WebGL2RenderingContext) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Floating-point GPU rendering is unavailable')
    this.maxSize = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0])
    if (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)!.precision < 23) throw new Error('GPU float precision is insufficient')
    this.program = makeProgram(gl, vertex, fragment)
    this.framebuffer = gl.createFramebuffer()!
    this.vao = gl.createVertexArray()!
    this.lookupUniform = gl.getUniformLocation(this.program, 'u_lookup')
    this.input = gl.getUniformLocation(this.program, 'u_input')
    this.n = gl.getUniformLocation(this.program, 'u_size')
    this.stage = gl.getUniformLocation(this.program, 'u_stage')
    this.logSize = gl.getUniformLocation(this.program, 'u_logSize')
  }

  supports(n: number): boolean { return !this.disposed && n >= 4 && n <= this.maxSize && (n & (n - 1)) === 0 }

  private texture(n: number, rows: number, format: number): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()
    if (!texture) throw new Error('Cannot allocate GPU FFT texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, n, rows)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  /** Returns a GPU-resident power texture. No sample or FFT readback is needed for display. */
  compute(samples: Float32Array, n: number, fullPrecision = false): WebGLTexture {
    const gl = this.gl, rows = samples.length / (2 * n)
    if (!this.supports(n) || !Number.isInteger(rows) || rows < 1 || rows > 256) throw new Error('Unsupported GPU FFT dimensions')
    if (gl.isContextLost()) throw new Error('Graphics context lost')
    gl.activeTexture(gl.TEXTURE0)
    if (this.size !== n || this.rows !== rows) {
      for (const texture of this.scratch) gl.deleteTexture(texture)
      this.scratch = []
      for (let i = 0; i < 3; ++i) this.scratch.push(this.texture(n, rows, gl.RG32F))
      if (this.size !== n || !this.lookup) {
        gl.deleteTexture(this.lookup)
        this.lookup = this.texture(n, 1, gl.RGBA32F)
        const values = new Float32Array(n * 4), bits = Math.log2(n)
        for (let i = 0; i < n; ++i) {
          let index = i, reverse = 0
          for (let bit = 0; bit < bits; ++bit) { reverse = (reverse << 1) | (index & 1); index >>= 1 }
          values[i * 4] = 0.5 * (1 - Math.cos(2 * Math.PI * reverse / (n - 1)))
          values[i * 4 + 1] = Math.cos(-2 * Math.PI * i / n)
          values[i * 4 + 2] = Math.sin(-2 * Math.PI * i / n)
          values[i * 4 + 3] = reverse
        }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, values)
      }
      this.size = n; this.rows = rows
    }
    gl.bindTexture(gl.TEXTURE_2D, this.scratch[0])
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, rows, gl.RG, gl.FLOAT, samples)
    const output = this.texture(n, rows, fullPrecision ? gl.R32F : gl.R16F)
    try {
      gl.bindVertexArray(this.vao)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
      gl.viewport(0, 0, n, rows)
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST)
      gl.useProgram(this.program)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lookup)
      gl.uniform1i(this.lookupUniform, 2); gl.activeTexture(gl.TEXTURE0)
      gl.uniform1i(this.input, 0); gl.uniform1i(this.n, n)
      const logSize = Math.log2(n)
      gl.uniform1i(this.logSize, logSize)
      let source = this.scratch[0]
      for (let stage = 0; stage <= logSize + 1; ++stage) {
        const target = stage === logSize + 1 ? output : this.scratch[1 + (stage % 2)]
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU FFT framebuffer is incomplete')
        gl.bindTexture(gl.TEXTURE_2D, source)
        gl.uniform1i(this.stage, stage)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        source = target
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU FFT failed')
      return output
    } catch (error) { gl.deleteTexture(output); throw error }
    finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null) }
  }

  /** Asynchronous fence for backend timing, without a blocking gl.finish(). */
  async finished(): Promise<void> {
    const gl = this.gl, fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!fence) throw new Error('Cannot create GPU completion fence')
    gl.flush()
    const started = performance.now()
    try {
      while (true) {
        if (this.disposed || gl.isContextLost()) throw new Error('GPU FFT unavailable')
        const status = gl.clientWaitSync(fence, 0, 0)
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return
        if (status === gl.WAIT_FAILED || performance.now() - started > 2000) throw new Error('GPU FFT timed out')
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    } finally { gl.deleteSync(fence) }
  }

  /** Used only by startup verification and regression tests, never the display hot path. */
  readPower(texture: WebGLTexture, n: number, rows: number): Float32Array {
    const gl = this.gl, rgba = new Float32Array(n * rows * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.readPixels(0, 0, n, rows, gl.RGBA, gl.FLOAT, rgba)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Cannot verify GPU FFT output')
    return Float32Array.from({ length: n * rows }, (_, i) => rgba[i * 4])
  }

  verify(): void {
    const n = 64, input = new Float32Array(n * 2)
    // An impulse after Hann windowing has equal power in all bins.
    input[n] = 1
    const output = this.compute(input, n, true)
    try {
      const expected = 20 * Math.log10((0.5 * (1 - Math.cos(2 * Math.PI * (n / 2) / (n - 1)))) / n)
      if (this.readPower(output, n, 1).some(v => !Number.isFinite(v) || Math.abs(v - expected) > 0.01)) throw new Error('GPU FFT validation failed')
    } finally { this.gl.deleteTexture(output) }
  }

  dispose(): void {
    this.disposed = true
    for (const texture of this.scratch) this.gl.deleteTexture(texture)
    this.scratch = []
    this.gl.deleteTexture(this.lookup); this.lookup = null
    this.gl.deleteProgram(this.program); this.gl.deleteFramebuffer(this.framebuffer); this.gl.deleteVertexArray(this.vao)
  }
}
