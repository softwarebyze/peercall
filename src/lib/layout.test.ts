import { describe, expect, test } from 'bun:test'
import { bestGrid, pickPresenter, resolveLayout, type LayoutTile } from './layout'

const WIDE = 16 / 9

describe('bestGrid', () => {
  test('a single tile fills the whole area', () => {
    expect(bestGrid(1, WIDE)).toEqual({ cols: 1, rows: 1 })
  })

  test('two tiles sit side by side on a wide area', () => {
    expect(bestGrid(2, WIDE)).toEqual({ cols: 2, rows: 1 })
  })

  test('three tiles use a 2x2 on a wide area instead of a 3x1 of slivers', () => {
    expect(bestGrid(3, WIDE)).toEqual({ cols: 2, rows: 2 })
  })

  test('three tiles stack on a tall narrow area', () => {
    expect(bestGrid(3, 0.6)).toEqual({ cols: 1, rows: 3 })
  })

  test('four tiles use a 2x2', () => {
    expect(bestGrid(4, WIDE)).toEqual({ cols: 2, rows: 2 })
  })

  test('five and six tiles use three columns', () => {
    expect(bestGrid(5, WIDE).cols).toBe(3)
    expect(bestGrid(6, WIDE)).toEqual({ cols: 3, rows: 2 })
  })

  test('every grid covers all tiles (cols * rows >= count)', () => {
    for (let count = 1; count <= 8; count++) {
      const { cols, rows } = bestGrid(count, WIDE)
      expect(cols * rows).toBeGreaterThanOrEqual(count)
      expect(cols).toBeGreaterThanOrEqual(1)
      expect(rows).toBeGreaterThanOrEqual(1)
    }
  })

  test('a nonsense aspect falls back to 16:9 instead of throwing', () => {
    expect(bestGrid(3, Number.NaN)).toEqual(bestGrid(3, WIDE))
    expect(bestGrid(3, 0)).toEqual(bestGrid(3, WIDE))
    expect(bestGrid(0, WIDE)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('pickPresenter', () => {
  const tile = (id: string, sharing: boolean, isLocal = false): LayoutTile => ({
    id,
    sharing,
    isLocal,
  })

  test('returns null when nobody shares', () => {
    expect(pickPresenter([tile('a', false), tile('b', false)])).toBeNull()
  })

  test('prefers a remote sharer over the local one', () => {
    expect(pickPresenter([tile('me', true, true), tile('b', true)])).toBe('b')
  })

  test('falls back to the local sharer when alone in sharing', () => {
    expect(pickPresenter([tile('me', true, true), tile('b', false)])).toBe('me')
  })
})

describe('resolveLayout', () => {
  const tiles: LayoutTile[] = [
    { id: 'me', sharing: false, isLocal: true },
    { id: 'b', sharing: false, isLocal: false },
    { id: 'c', sharing: false, isLocal: false },
  ]

  test('spotlights the presenter when someone shares', () => {
    const sharing = tiles.map((t) => (t.id === 'c' ? { ...t, sharing: true } : t))
    expect(resolveLayout({ tiles: sharing, pinnedId: null, aspect: WIDE })).toEqual({
      mode: 'spotlight',
      stageId: 'c',
    })
  })

  test('a pin overrides the presenter', () => {
    const sharing = tiles.map((t) => (t.id === 'c' ? { ...t, sharing: true } : t))
    expect(resolveLayout({ tiles: sharing, pinnedId: 'b', aspect: WIDE })).toEqual({
      mode: 'spotlight',
      stageId: 'b',
    })
  })

  test('ignores a pin for someone who is no longer present', () => {
    expect(resolveLayout({ tiles, pinnedId: 'ghost', aspect: WIDE })).toEqual({
      mode: 'grid',
      cols: 2,
      rows: 2,
    })
  })

  test('falls back to a grid when nobody shares and nothing is pinned', () => {
    expect(resolveLayout({ tiles, pinnedId: null, aspect: WIDE })).toEqual({
      mode: 'grid',
      cols: 2,
      rows: 2,
    })
  })
})
