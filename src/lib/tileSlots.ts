import { gridTracks, type CallLayout } from './layout'

export interface TileSlot { variant: 'grid' | 'stage' | 'strip'; column: string; row: string; stripOffset?: number; stripCount?: number }

/** Keep every media tile under the same parent while only changing its grid slot. */
export function tileSlots(ids: string[], layout: CallLayout) {
  const slots: Record<string, TileSlot> = {}
  if (layout.mode === 'grid') {
    const tracks = gridTracks(ids.length, layout.cols, layout.rows)
    ids.forEach((id, i) => {
      const offset = i >= tracks.lastRowStart ? tracks.lastRowOffset : 0
      const column = (i % layout.cols) * tracks.span + 1 + offset
      slots[id] = { variant: 'grid', column: `${column} / span ${tracks.span}`, row: `${Math.floor(i / layout.cols) + 1}` }
    })
    return { slots, columns: tracks.unit, rows: `repeat(${layout.rows}, minmax(0, 1fr))` }
  }
  const stageIds = layout.mode === 'spotlight' ? [layout.stageId] : layout.stageIds
  const stripIds = ids.filter(id => !stageIds.includes(id))
  const cols = layout.mode === 'spotlight' ? 1 : layout.cols
  const rows = layout.mode === 'spotlight' ? 1 : layout.rows
  const tracks = gridTracks(stageIds.length, cols, rows)
  const columns = tracks.unit
  stageIds.forEach((id, i) => {
    const offset = i >= tracks.lastRowStart ? tracks.lastRowOffset : 0
    slots[id] = { variant: 'stage', column: `${(i % cols) * tracks.span + offset + 1} / span ${tracks.span}`, row: `${Math.floor(i / cols) + 1}` }
  })
  stripIds.forEach((id, i) => {
    slots[id] = { variant: 'strip', column: '1 / -1', row: `${rows + 1}`, stripOffset: i - (stripIds.length - 1) / 2, stripCount: stripIds.length }
  })
  return { slots, columns, rows: `repeat(${rows}, minmax(0, 1fr))${stripIds.length ? ' clamp(72px, 16vh, 112px)' : ''}` }
}
