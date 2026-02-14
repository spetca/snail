/**
 * Generate colormap textures for spectrogram rendering.
 * Ports the HSV colormap from inspectrum spectrogramplot.cpp lines 46-49,
 * plus a dark-mode "plasma-dark" variant.
 */

export type ColorMapType = 'inspectrum' | 'plasma-dark'

/**
 * Generate a 256x1 RGBA Uint8Array colormap.
 */
export function generateColorMap(type: ColorMapType = 'plasma-dark'): Uint8Array {
  const data = new Uint8Array(256 * 4)

  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r: number, g: number, b: number

    if (type === 'inspectrum') {
      // HSV rainbow: H = 240 -> 0 (blue -> red), S=1, V=t
      const h = (1 - t) * 240 / 360
      const [cr, cg, cb] = hsvToRgb(h, 1, t)
      r = cr; g = cg; b = cb
    } else {
      // Plasma-dark: black -> purple -> blue -> cyan -> white
      if (t < 0.25) {
        const s = t / 0.25
        r = s * 0.4
        g = 0
        b = s * 0.6
      } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25
        r = 0.4 * (1 - s) + s * 0.1
        g = 0
        b = 0.6 + s * 0.4
      } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25
        r = 0.1 * (1 - s)
        g = s * 0.8
        b = 1.0
      } else {
        const s = (t - 0.75) / 0.25
        r = s
        g = 0.8 + s * 0.2
        b = 1.0
      }
    }

    data[i * 4 + 0] = Math.round(r * 255)
    data[i * 4 + 1] = Math.round(g * 255)
    data[i * 4 + 2] = Math.round(b * 255)
    data[i * 4 + 3] = 255
  }

  return data
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    case 5: return [v, p, q]
    default: return [0, 0, 0]
  }
}
