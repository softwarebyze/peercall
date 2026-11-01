import { describe, expect, test } from 'bun:test'
import { parseSignalMsg } from './signalMsg'

describe('parseSignalMsg', () => {
  test('accepts a joined payload', () => {
    const parsed = parseSignalMsg({
      t: 'joined',
      payload: { id: 'p1', roomId: 'r1', isHost: true },
    })
    expect(parsed).toEqual({
      kind: 'ok',
      msg: { t: 'joined', payload: { id: 'p1', roomId: 'r1', isHost: true } },
    })
  })

  test('rejects missing fields', () => {
    expect(parseSignalMsg({ t: 'joined', payload: { id: 'p1' } })).toEqual({ kind: 'invalid' })
  })

  test('rejects unknown types', () => {
    expect(parseSignalMsg({ t: 'explode', payload: {} })).toEqual({ kind: 'invalid' })
  })

  test('rejects malformed json shapes', () => {
    expect(parseSignalMsg(null)).toEqual({ kind: 'invalid' })
    expect(parseSignalMsg('joined')).toEqual({ kind: 'invalid' })
  })

  test('parses a peer sharing flag from room state', () => {
    const parsed = parseSignalMsg({
      t: 'room_state',
      payload: { peers: [{ id: 'p1', name: 'A', isHost: true, sharing: true }], chat: [] },
    })
    expect(parsed).toEqual({
      kind: 'ok',
      msg: {
        t: 'room_state',
        payload: { peers: [{ id: 'p1', name: 'A', isHost: true, sharing: true, micOn: true }], chat: [] },
      },
    })
  })

  test('defaults a missing sharing flag to false for older servers', () => {
    const parsed = parseSignalMsg({
      t: 'peer_joined',
      payload: { id: 'p2', name: 'B', isHost: false },
    })
    expect(parsed).toEqual({
      kind: 'ok',
      msg: { t: 'peer_joined', payload: { id: 'p2', name: 'B', isHost: false, sharing: false, micOn: true } },
    })
  })
})

test('preserves explicit remote mute status', () => {
  const parsed = parseSignalMsg({
    t: 'room_state',
    payload: { peers: [{ id: 'p1', name: 'A', isHost: true, micOn: false }], chat: [] },
  })
  expect(parsed.kind === 'ok' && parsed.msg.t === 'room_state' && parsed.msg.payload.peers[0]?.micOn).toBe(false)
})
