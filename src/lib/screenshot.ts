export type CaptureResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'empty' }
  | { kind: 'failed'; message: string }

const TILE_W = 640
const TILE_H = 360

function downloadBlob(args: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(args.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = args.filename
  a.click()
  URL.revokeObjectURL(url)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

function drawName(args: { ctx: CanvasRenderingContext2D; x: number; y: number; name: string }): void {
  args.ctx.fillStyle = 'rgba(13,13,15,0.72)'
  args.ctx.fillRect(args.x, args.y + TILE_H - 36, TILE_W, 36)
  args.ctx.fillStyle = '#f5f5f6'
  args.ctx.font = '600 16px "JetBrains Mono", monospace'
  args.ctx.fillText(args.name, args.x + 12, args.y + TILE_H - 14)
}

/** Composite visible call tiles into a PNG and save it locally. */
export async function captureCallScreenshot(args: { grid: HTMLElement }): Promise<CaptureResult> {
  const tiles = [...args.grid.querySelectorAll<HTMLElement>('[data-tile]')]
  if (tiles.length === 0) return { kind: 'empty' }

  const cols = Math.min(tiles.length, tiles.length === 2 ? 2 : Math.ceil(Math.sqrt(tiles.length)))
  const rows = Math.ceil(tiles.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * TILE_W
  canvas.height = rows * TILE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return { kind: 'failed', message: 'Could not create canvas' }

  ctx.fillStyle = '#0d0d0f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const [index, tile] of tiles.entries()) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = col * TILE_W
    const y = row * TILE_H
    const video = tile.querySelector('video')
    const name = tile.dataset.tileName ?? 'Peer'
    const hasFrame = video !== null && video.videoWidth > 0 && video.style.visibility !== 'hidden'

    if (hasFrame && video) {
      ctx.drawImage(video, x, y, TILE_W, TILE_H)
    } else {
      ctx.fillStyle = '#131316'
      ctx.fillRect(x, y, TILE_W, TILE_H)
      ctx.fillStyle = '#00ff88'
      ctx.font = '700 48px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(name.charAt(0).toUpperCase(), x + TILE_W / 2, y + TILE_H / 2 + 16)
      ctx.textAlign = 'left'
    }
    drawName({ ctx, x, y, name })
  }

  const blob = await canvasToBlob(canvas)
  if (!blob) return { kind: 'failed', message: 'Could not encode PNG' }

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  downloadBlob({ blob, filename: `peercall-${stamp}.png` })
  return { kind: 'ok', blob }
}
