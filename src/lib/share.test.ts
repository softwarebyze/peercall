import { describe, expect, test } from 'bun:test'
import { shareInvite, type ShareNavigatorLike } from './share'

describe('shareInvite', () => {
  test('uses the native share sheet when available', async () => {
    const shared: unknown[] = []
    const nav: ShareNavigatorLike = {
      share: async (data) => {
        shared.push(data)
      },
      canShare: () => true,
    }
    const result = await shareInvite({
      url: 'https://peercall.example/room/abc-def',
      roomId: 'abc-def',
      navigator: nav,
    })
    expect(result).toBe('shared')
    expect(shared).toEqual([
      {
        title: 'PeerCall',
        text: 'Join my PeerCall room abc-def',
        url: 'https://peercall.example/room/abc-def',
      },
    ])
  })

  test('a dismissed sheet is a cancellation, not an error', async () => {
    const error = new Error('dismissed')
    error.name = 'AbortError'
    const nav: ShareNavigatorLike = {
      share: async () => {
        throw error
      },
    }
    const result = await shareInvite({
      url: 'https://peercall.example/room/abc-def',
      roomId: 'abc-def',
      navigator: nav,
    })
    expect(result).toBe('cancelled')
  })

  test('no share sheet means unavailable, never a silent copy', async () => {
    const result = await shareInvite({
      url: 'https://peercall.example/room/abc-def',
      roomId: 'abc-def',
      navigator: {},
    })
    expect(result).toBe('unavailable')
  })

  test('canShare rejecting the url means unavailable', async () => {
    const shared: unknown[] = []
    const nav: ShareNavigatorLike = {
      share: async (data) => {
        shared.push(data)
      },
      canShare: () => false,
    }
    const result = await shareInvite({
      url: 'https://peercall.example/room/abc-def',
      roomId: 'abc-def',
      navigator: nav,
    })
    expect(result).toBe('unavailable')
    expect(shared).toEqual([])
  })

  test('a failed share means unavailable', async () => {
    const nav: ShareNavigatorLike = {
      share: async () => {
        throw new Error('not allowed')
      },
    }
    const result = await shareInvite({
      url: 'https://peercall.example/room/abc-def',
      roomId: 'abc-def',
      navigator: nav,
    })
    expect(result).toBe('unavailable')
  })
})
