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
