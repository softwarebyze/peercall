import jsQR from 'jsqr'

/** Try both polarities before binarization, so bright-on-dark codes retain contrast. */
export function scanQr(data: Uint8ClampedArray, width: number, height: number): string | null {
  const normal = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
  if (normal) return normal.data
  const inverted = new Uint8ClampedArray(data)
  for (let i = 0; i < inverted.length; i += 4) {
    inverted[i] = 255 - inverted[i]!
    inverted[i + 1] = 255 - inverted[i + 1]!
    inverted[i + 2] = 255 - inverted[i + 2]!
  }
  const reversed = jsQR(inverted, width, height, { inversionAttempts: 'dontInvert' })
  if (reversed) return reversed.data
  // A second scale avoids module edges aligning poorly with the decoder's blocks.
  const w = Math.floor(width / 2)
  const h = Math.floor(height / 2)
  if (!w || !h) return null
  const smaller = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const source = ((y * 2) * width + x * 2) * 4
      smaller.set(data.subarray(source, source + 4), (y * w + x) * 4)
    }
  }
  return jsQR(smaller, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null
}
