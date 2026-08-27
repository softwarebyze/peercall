import { describe, expect, test } from 'bun:test'
import { parseRoomJoin } from './roomUrl'

const origin = 'https://peercall.fly.dev'

describe('parseRoomJoin', () => {
  test('qr accepts same-origin room url', () => {
    const result = parseRoomJoin({
      text: 'https://peercall.fly.dev/room/abc-def12xyz',
      origin,
      mode: 'qr',
    })
    expect(result).toEqual({ kind: 'room', roomId: 'abc-def12xyz' })
  })

  test('qr rejects other origins', () => {
    const result = parseRoomJoin({
      text: 'https://evil.example/room/abc-def12xyz',
      origin,
      mode: 'qr',
    })
    expect(result).toEqual({ kind: 'invalid', reason: 'wrong_origin' })
  })

  test('qr rejects non-room paths', () => {
    const result = parseRoomJoin({
      text: 'https://peercall.fly.dev/not-a-room',
      origin,
      mode: 'qr',
    })
    expect(result).toEqual({ kind: 'invalid', reason: 'not_room_path' })
  })

  test('paste accepts a bare room id', () => {
    const result = parseRoomJoin({ text: 'room12-ab', origin, mode: 'paste' })
    expect(result).toEqual({ kind: 'room', roomId: 'room12-ab' })
  })

  test('paste accepts a path', () => {
    const result = parseRoomJoin({ text: '/room/host-room-1', origin, mode: 'paste' })
    expect(result).toEqual({ kind: 'room', roomId: 'host-room-1' })
  })

  test('paste accepts a foreign-origin room url', () => {
    const result = parseRoomJoin({
      text: 'http://localhost:3000/room/local-room-1',
      origin,
      mode: 'paste',
    })
    expect(result).toEqual({ kind: 'room', roomId: 'local-room-1' })
  })

  test('paste still accepts truncated UUID room ids', () => {
    const result = parseRoomJoin({ text: '805d775b-cbe', origin, mode: 'paste' })
    expect(result).toEqual({ kind: 'room', roomId: '805d775b-cbe' })
  })

  test('empty is invalid', () => {
    expect(parseRoomJoin({ text: '  ', origin, mode: 'paste' })).toEqual({
      kind: 'invalid',
      reason: 'empty',
    })
  })
})
