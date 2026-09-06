// In-place radix-2 FFT used by constellation carrier estimation.
export function tsfft(re: Float64Array, im: Float64Array) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            ;[re[i], re[j]] = [re[j], re[i]]
            ;[im[i], im[j]] = [im[j], im[i]]
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len
        const wlen_re = Math.cos(ang), wlen_im = Math.sin(ang)
        for (let i = 0; i < n; i += len) {
            let w_re = 1, w_im = 0
            for (let j = 0; j < len / 2; j++) {
                const tr = re[i + j + len / 2] * w_re - im[i + j + len / 2] * w_im
                const ti = re[i + j + len / 2] * w_im + im[i + j + len / 2] * w_re
                re[i + j + len / 2] = re[i + j] - tr
                im[i + j + len / 2] = im[i + j] - ti
                re[i + j] += tr
                im[i + j] += ti
                const tmp = w_re * wlen_re - w_im * wlen_im
                w_im = w_re * wlen_im + w_im * wlen_re
                w_re = tmp
            }
        }
    }
}
