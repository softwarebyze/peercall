export interface LayoutTile {
  id: string
  sharing: boolean
  isLocal: boolean
}

export type CallLayout =
  | { mode: 'grid'; cols: number; rows: number }
  | { mode: 'spotlight'; stageId: string }

const TARGET_TILE_ASPECT = 16 / 9

/**
 * Pick a column/row count for `count` equally-sized tiles in a container of
 * `aspect` (width / height).
 *
 * Counting alone produces tall "vertical slices" — 3 tiles on a wide screen
 * became a 3x1 row of skinny columns. Factoring in the container aspect keeps
 * the tiles near 16:9 while still filling the space, so 3 tiles on a 16:9 area
 * land on a 2x2 (one cell empty) instead. Ties break toward the larger tiles.
 */
export function bestGrid(count: number, aspect: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 }
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : TARGET_TILE_ASPECT
  let best = { cols: count, rows: 1 }
  let bestScore = -Infinity
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    // Real pixel aspect of one cell: (rows / cols) * containerAspect.
    const tileAspect = (rows / cols) * safeAspect
    const area = 1 / (cols * rows)
    const aspectPenalty = Math.abs(Math.log(tileAspect / TARGET_TILE_ASPECT))
    const score = area - aspectPenalty * 0.15
    // `>=` lets a tie prefer the later (more-column) candidate: on a wide area
    // 2 tiles side-by-side beats stacking, which is what people expect.
    if (score >= bestScore - 1e-9) {
      bestScore = score
      best = { cols, rows }
    }
  }
  return best
}

/** The peer whose shared screen should take the stage, if anyone is sharing. */
export function pickPresenter(tiles: LayoutTile[]): string | null {
  const sharers = tiles.filter((t) => t.sharing)
  if (sharers.length === 0) return null
  // Prefer a remote presenter so your own share doesn't fight a spotlight you
  // are already watching; fall back to the first sharer when only you share.
  return (sharers.find((t) => !t.isLocal) ?? sharers[0]).id
}

/**
 * Resolve the call layout:
 *  - an explicit pin wins (focus one participant),
 *  - otherwise an active screen share is spotlighted,
 *  - otherwise everyone shares an even grid sized to the container.
 */
export function resolveLayout(args: {
  tiles: LayoutTile[]
  pinnedId: string | null
  aspect: number
}): CallLayout {
  const { tiles, pinnedId, aspect } = args
  if (pinnedId !== null && tiles.some((t) => t.id === pinnedId)) {
    return { mode: 'spotlight', stageId: pinnedId }
  }
  const presenter = pickPresenter(tiles)
  if (presenter !== null) return { mode: 'spotlight', stageId: presenter }
  const { cols, rows } = bestGrid(tiles.length, aspect)
  return { mode: 'grid', cols, rows }
}
