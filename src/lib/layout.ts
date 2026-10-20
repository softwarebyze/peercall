export interface LayoutTile {
  id: string
  sharing: boolean
  isLocal: boolean
}

export type CallLayout =
  | { mode: 'grid'; cols: number; rows: number }
  | { mode: 'spotlight'; stageId: string }
  | { mode: 'shares'; stageIds: string[]; cols: number; rows: number }

const TARGET_TILE_ASPECT = 16 / 9

/**
 * Pick a column/row count for `count` equally-sized tiles in a container of
 * `aspect` (width / height).
 *
 * Counting alone produces tall "vertical slices" — 3 tiles on a wide screen
 * became a 3x1 row of skinny columns. Factoring in the container aspect keeps
 * the tiles near 16:9 while still filling the space, so 3 tiles on a 16:9 area
 * land on a 2x2 instead. Ties break toward the larger tiles.
 *
 * A partial last row is handled by {@link gridTracks}, which centers those
 * tiles instead of leaving a dead cell.
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

export interface GridTracks {
  /** Number of equal columns the template is divided into. */
  unit: number
  /** Columns each tile spans (uniform across the grid). */
  span: number
  /** Index of the first tile on the final (possibly partial) row. */
  lastRowStart: number
  /** Extra columns to skip before that tile, centering the short row. */
  lastRowOffset: number
}

/**
 * Turn a `cols`x`rows` grid into tracks that leave no dead cells.
 *
 * A plain `repeat(cols, 1fr)` grid left the empty cells of a partial last row as
 * bare background (3 people in a 2x2 left the bottom-right hole dark, which read
 * as a failed tile). Doubling the column count gives the half-cell granularity
 * needed to center that short row — 5 people in a 3x2 center two tiles with one
 * cell of margin each side — while every tile keeps an identical size, so no
 * camera feed gets stretched or cover-cropped.
 */
export function gridTracks(count: number, cols: number, rows: number): GridTracks {
  const fullRow: GridTracks = { unit: cols, span: 1, lastRowStart: count, lastRowOffset: 0 }
  if (count <= 0 || cols <= 1 || rows <= 1) return fullRow
  const lastRow = count - (rows - 1) * cols
  if (lastRow <= 0 || lastRow === cols) return fullRow
  const unit = cols * 2
  const span = 2
  return {
    unit,
    span,
    lastRowStart: (rows - 1) * cols,
    lastRowOffset: (unit - lastRow * span) / 2,
  }
}

/**
 * Everyone currently sharing, ordered remote-first. A remote presenter leads so
 * your own share doesn't fight a stage you are already watching; when only you
 * share, you lead.
 */
export function pickSharers(tiles: LayoutTile[]): string[] {
  const sharers = tiles.filter((t) => t.sharing)
  const ordered = [...sharers.filter((t) => !t.isLocal), ...sharers.filter((t) => t.isLocal)]
  return ordered.map((t) => t.id)
}

/**
 * Resolve the call layout:
 *  - otherwise a lone sharer is spotlighted,
 *  - otherwise concurrent sharers split the stage, so a second share stays
 *    readable instead of shrinking to a filmstrip thumbnail,
 *  - otherwise everyone shares an even grid sized to the container.
 */
export function resolveLayout(args: {
  tiles: LayoutTile[]
  aspect: number
}): CallLayout {
  const { tiles, aspect } = args
  const sharers = pickSharers(tiles)
  if (sharers.length > 1) {
    const { cols, rows } = bestGrid(sharers.length, aspect)
    return { mode: 'shares', stageIds: sharers, cols, rows }
  }
  const sole = sharers[0]
  if (sole !== undefined) return { mode: 'spotlight', stageId: sole }
  const { cols, rows } = bestGrid(tiles.length, aspect)
  return { mode: 'grid', cols, rows }
}
