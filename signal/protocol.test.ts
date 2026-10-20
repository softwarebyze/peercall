import { beforeEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { handleMessage, rooms } from './protocol'

type Sent = { t: string; payload: Record<string, unknown> }

function fakeWs() {
  const sent: Sent[] = []
  const ws = {
    sent,
    send(raw: string) {
      sent.push(JSON.parse(raw) as Sent)
    },
    close() {},
  }
  return ws as typeof ws & ServerWebSocket<unknown>
}

function join(ws: ReturnType<typeof fakeWs>, roomId: string, name: string) {
  handleMessage(ws, JSON.stringify({ t: 'join', payload: { roomId, name } }))
}

beforeEach(() => {
  rooms.clear()
})

describe('handleMessage join', () => {
  test('trims and caps the display name at 40 characters', () => {
    const ws = fakeWs()
    join(ws, 'r1', `   ${'x'.repeat(100)}   `)
    const peer = [...(rooms.get('r1')?.peers.values() ?? [])][0]
    expect(peer?.name).toHaveLength(40)
    expect(peer?.name).toBe('x'.repeat(40))
  })

  test('rejects an empty name', () => {
    const ws = fakeWs()
    join(ws, 'r1', '   ')
    expect(ws.sent.some((m) => m.t === 'error')).toBe(true)
    expect(rooms.has('r1')).toBe(false)
  })

  test('rejects a room id longer than 64 characters', () => {
    const ws = fakeWs()
    join(ws, 'y'.repeat(65), 'A')
    expect(ws.sent.some((m) => m.t === 'error')).toBe(true)
    expect(rooms.size).toBe(0)
  })

  test('caps the room at 8 peers', () => {
    for (let i = 0; i < 8; i++) join(fakeWs(), 'full', `P${i}`)
    const ninth = fakeWs()
    join(ninth, 'full', 'Late')
    expect(ninth.sent.some((m) => m.t === 'error')).toBe(true)
    expect(rooms.get('full')?.peers.size).toBe(8)
  })

  test('a re-join on the same socket leaves the previous room', () => {
    const ws = fakeWs()
    join(ws, 'old', 'A')
    expect(rooms.get('old')?.peers.size).toBe(1)

    join(ws, 'new', 'A')
    expect(rooms.has('old')).toBe(false)
    expect(rooms.get('new')?.peers.size).toBe(1)
  })

  test('re-joining notifies the peers left behind', () => {
    const stayer = fakeWs()
    join(stayer, 'old', 'Stayer')
    const mover = fakeWs()
    join(mover, 'old', 'Mover')

    stayer.sent.length = 0
    join(mover, 'new', 'Mover')

    expect(stayer.sent.some((m) => m.t === 'peer_left')).toBe(true)
  })

  test('a join the destination refuses keeps the socket in its current room', () => {
    const room = fakeWs()
    join(room, 'home', 'AtHome')
    for (let i = 0; i < 8; i++) join(fakeWs(), 'full', `P${i}`)

    const mover = fakeWs()
    join(mover, 'home', 'Mover')
    room.sent.length = 0
    mover.sent.length = 0

    join(mover, 'full', 'Mover')

    // The rejected join must not evict the mover from 'home' (a peer_left would
    // leave the stayer rendering someone who is still there) ...
    expect(mover.sent.some((m) => m.t === 'error')).toBe(true)
    expect(room.sent.some((m) => m.t === 'peer_left')).toBe(false)
    expect(rooms.get('home')?.peers.size).toBe(2)
    expect(rooms.get('full')?.peers.size).toBe(8)

    // ... and the socket must still be able to talk in the room it kept.
    mover.sent.length = 0
    handleMessage(mover, JSON.stringify({ t: 'chat', payload: { text: 'still here' } }))
    expect(rooms.get('home')?.chat.at(-1)?.text).toBe('still here')
  })

  test('a same-room re-join is allowed while the room is at capacity', () => {
    const ws = fakeWs()
    join(ws, 'packed', 'A')
    for (let i = 1; i < 8; i++) join(fakeWs(), 'packed', `P${i}`)
    expect(rooms.get('packed')?.peers.size).toBe(8)

    join(ws, 'packed', 'A')

    expect(ws.sent.some((m) => m.t === 'error')).toBe(false)
    expect(rooms.get('packed')?.peers.size).toBe(8)
  })
})

describe('handleMessage screen_share', () => {
  function sharingOf(ws: ReturnType<typeof fakeWs>, name: string): boolean | undefined {
    const state = ws.sent.filter((m) => m.t === 'room_state').at(-1)
    const peers = state?.payload.peers as { name: string; sharing: boolean }[] | undefined
    return peers?.find((p) => p.name === name)?.sharing
  }

  test('marks the sharer and rebroadcasts room state', () => {
    const ws = fakeWs()
    join(ws, 's1', 'A')
    ws.sent.length = 0

    handleMessage(ws, JSON.stringify({ t: 'screen_share', payload: { sharing: true } }))

    expect(sharingOf(ws, 'A')).toBe(true)
  })

  test('a late joiner sees the existing sharer', () => {
    const sharer = fakeWs()
    join(sharer, 's2', 'Sharer')
    handleMessage(sharer, JSON.stringify({ t: 'screen_share', payload: { sharing: true } }))

    const late = fakeWs()
    join(late, 's2', 'Late')

    expect(sharingOf(late, 'Sharer')).toBe(true)
    expect(sharingOf(late, 'Late')).toBe(false)
  })

  test('stops sharing when the flag flips back', () => {
    const ws = fakeWs()
    join(ws, 's3', 'A')
    handleMessage(ws, JSON.stringify({ t: 'screen_share', payload: { sharing: true } }))
    handleMessage(ws, JSON.stringify({ t: 'screen_share', payload: { sharing: false } }))

    expect(sharingOf(ws, 'A')).toBe(false)
  })

  test('ignores a malformed sharing flag', () => {
    const ws = fakeWs()
    join(ws, 's4', 'A')
    ws.sent.length = 0

    handleMessage(ws, JSON.stringify({ t: 'screen_share', payload: { sharing: 'yes' } }))

    expect(ws.sent.some((m) => m.t === 'room_state')).toBe(false)
  })

  test('ignores screen_share before joining', () => {
    const ws = fakeWs()
    handleMessage(ws, JSON.stringify({ t: 'screen_share', payload: { sharing: true } }))
    expect(ws.sent.some((m) => m.t === 'error' && m.payload.message === 'not joined')).toBe(true)
  })
})

describe('handleMessage chat', () => {
  test('caps message text at 2000 characters', () => {
    const ws = fakeWs()
    join(ws, 'c1', 'A')
    handleMessage(ws, JSON.stringify({ t: 'chat', payload: { text: 'z'.repeat(5000) } }))
    const entry = rooms.get('c1')?.chat.at(-1)
    expect(entry?.text).toHaveLength(2000)
  })

  test('ignores chat before joining', () => {
    const ws = fakeWs()
    handleMessage(ws, JSON.stringify({ t: 'chat', payload: { text: 'hi' } }))
    expect(ws.sent.some((m) => m.t === 'error' && m.payload.message === 'not joined')).toBe(true)
  })
})

describe('handleMessage media_state', () => {
  test('broadcasts mute intent to existing peers and preserves it for late joiners', () => {
    const alice = fakeWs()
    const bob = fakeWs()
    join(alice, 'mute-room', 'Alice')
    join(bob, 'mute-room', 'Bob')
    handleMessage(alice, JSON.stringify({ t: 'media_state', payload: { micOn: false } }))
    const state = bob.sent.filter(m => m.t === 'room_state').at(-1)
    expect((state?.payload.peers as { name: string; micOn: boolean }[]).find(p => p.name === 'Alice')?.micOn).toBe(false)
    const late = fakeWs()
    join(late, 'mute-room', 'Late')
    const lateState = late.sent.filter(m => m.t === 'room_state').at(-1)
    expect((lateState?.payload.peers as { name: string; micOn: boolean }[]).find(p => p.name === 'Alice')?.micOn).toBe(false)
    handleMessage(alice, JSON.stringify({ t: 'media_state', payload: { micOn: true } }))
    expect([...rooms.get('mute-room')!.peers.values()].find(p => p.name === 'Alice')?.micOn).toBe(true)
  })

  test('ignores malformed state and cannot change another sender’s state', () => {
    const alice = fakeWs()
    const bob = fakeWs()
    join(alice, 'mute-validation', 'Alice')
    join(bob, 'mute-validation', 'Bob')
    handleMessage(alice, JSON.stringify({ t: 'media_state', payload: { micOn: 'false' } }))
    expect([...rooms.get('mute-validation')!.peers.values()].every(p => p.micOn)).toBe(true)
    const bobId = [...rooms.get('mute-validation')!.peers.values()].find(p => p.name === 'Bob')!.id
    handleMessage(alice, JSON.stringify({ t: 'media_state', payload: { id: bobId, micOn: false } }))
    expect(rooms.get('mute-validation')!.peers.get(bobId)?.micOn).toBe(true)
  })
})
