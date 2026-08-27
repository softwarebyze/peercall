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
})
