import { describe, expect, test } from 'bun:test'
import { bestGrid, gridTracks, pickSharers, resolveLayout, type LayoutTile } from './layout'

const WIDE = 16 / 9

describe('gridTracks', () => {
  test('a full grid stays on plain single columns', () => {
    expect(gridTracks(4, 2, 2)).toEqual({ unit: 2, span: 1, lastRowStart: 4, lastRowOffset: 0 })
  })

  test('a lone tile on the last row is centered (3 in a 2x2)', () => {
    expect(gridTracks(3, 2, 2)).toEqual({ unit: 4, span: 2, lastRowStart: 2, lastRowOffset: 1 })
  })

  test('two tiles on the last row are centered in a 3x2 (5 people)', () => {
    expect(gridTracks(5, 3, 2)).toEqual({ unit: 6, span: 2, lastRowStart: 3, lastRowOffset: 1 })
  })

  test('equal-size tiles whose final row stays centered', () => {
    for (const [count, cols, rows] of [
      [2, 2, 1],
      [3, 2, 2],
      [4, 3, 2],
      [5, 3, 2],
      [7, 4, 2],
      [8, 3, 3],
    ] as const) {
      const { unit, span, lastRowStart, lastRowOffset } = gridTracks(count, cols, rows)
      expect(span * cols).toBe(unit)
      expect(Number.isInteger(lastRowOffset)).toBe(true)
      if (lastRowOffset > 0) {
        const lastRow = count - lastRowStart
        expect(lastRowStart).toBe((rows - 1) * cols)
        expect(lastRow).toBeGreaterThan(0)
        expect(lastRow).toBeLessThanOrEqual(cols)
        // Centered: equal margins either side of the short row.
        expect(lastRow * span + 2 * lastRowOffset).toBe(unit)
      }
    }
  })
})

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

describe('pickSharers', () => {
  const tile = (id: string, sharing: boolean, isLocal = false): LayoutTile => ({
    id,
    sharing,
    isLocal,
  })

  test('returns nobody when nobody shares', () => {
    expect(pickSharers([tile('a', false), tile('b', false)])).toEqual([])
  })

  test('orders a remote sharer ahead of the local one', () => {
    expect(pickSharers([tile('me', true, true), tile('b', true)])).toEqual(['b', 'me'])
  })

  test('leads with the local sharer when nobody else shares', () => {
    expect(pickSharers([tile('me', true, true), tile('b', false)])).toEqual(['me'])
  })

  test('keeps every sharer, so a second share is not dropped', () => {
    expect(
      pickSharers([tile('me', false, true), tile('b', true), tile('c', true)]),
    ).toEqual(['b', 'c'])
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

  test('two concurrent sharers split the stage instead of one becoming a thumbnail', () => {
    const sharing = tiles.map((t) => (t.id === 'c' || t.id === 'b' ? { ...t, sharing: true } : t))
    expect(resolveLayout({ tiles: sharing, pinnedId: null, aspect: WIDE })).toEqual({
      mode: 'shares',
      stageIds: ['b', 'c'],
      cols: 2,
      rows: 1,
    })
  })

  test('a split stacks the shares on a tall area', () => {
    const sharing = tiles.map((t) => (t.id === 'c' || t.id === 'b' ? { ...t, sharing: true } : t))
    expect(resolveLayout({ tiles: sharing, pinnedId: null, aspect: 0.6 })).toEqual({
      mode: 'shares',
      stageIds: ['b', 'c'],
      cols: 1,
      rows: 2,
    })
  })

  test('a pin still overrides a split', () => {
    const sharing = tiles.map((t) => (t.id === 'c' || t.id === 'b' ? { ...t, sharing: true } : t))
    expect(resolveLayout({ tiles: sharing, pinnedId: 'me', aspect: WIDE })).toEqual({
      mode: 'spotlight',
      stageId: 'me',
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
