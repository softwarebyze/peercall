import { encode } from 'uqr'

export function QrCode(args: { text: string; size?: number; label: string }) {
  const encoded = encode(args.text, { border: 2, ecc: 'M' })
  const cells = encoded.size
  const px = args.size ?? 148
  const dots: string[] = []
  for (let y = 0; y < cells; y++) {
    const row = encoded.data[y]
    if (!row) continue
    for (let x = 0; x < cells; x++) {
      if (row[x]) dots.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${cells} ${cells}`}
      role="img"
      aria-label={args.label}
      shapeRendering="crispEdges"
    >
      <rect width={cells} height={cells} fill="#0d0d0f" />
      <path d={dots.join('')} fill="#00ff88" />
    </svg>
  )
}
