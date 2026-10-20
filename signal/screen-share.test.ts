import { afterEach, expect, test } from 'bun:test'
import { handleMessage, rooms } from './protocol'
import type { ServerWebSocket } from 'bun'

function peer(name: string) {
  const messages: { t: string; payload: any }[] = []
  const ws = { send: (raw: string) => messages.push(JSON.parse(raw)) } as unknown as ServerWebSocket<unknown>
  const send = (t: string, payload: unknown) => handleMessage(ws, JSON.stringify({ t, payload }))
  send('join', { roomId: 'screen-test', name })
  return { send, messages, id: messages.find(m => m.t === 'joined')!.payload.id }
}
const state = (p: ReturnType<typeof peer>) => p.messages.filter(m => m.t === 'room_state').at(-1)!.payload

afterEach(() => rooms.clear())
test('sharing is broadcast to peers and late joiners, then cleared on stop', () => {
  const alice = peer('Alice')
  const bob = peer('Bob')
  alice.send('screen_share', { sharing: true })
  expect(state(bob).peers.find((p: any) => p.id === alice.id).sharing).toBe(true)
  const carol = peer('Carol')
  expect(state(carol).peers.find((p: any) => p.id === alice.id).sharing).toBe(true)
  alice.send('screen_share', { sharing: false })
  expect(state(carol).peers.find((p: any) => p.id === alice.id).sharing).toBe(false)
})
test('invalid sharing payloads cannot put a participant on the stage', () => {
  const alice = peer('Alice')
  for (const payload of [null, {}, {sharing: 'true'}, {sharing: 1}]) alice.send('screen_share', payload)
  expect(state(alice).peers[0].sharing).toBe(false)
})
