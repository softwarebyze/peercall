import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId } from './helpers'

test('ninth peer sees a room-full error', async ({ browser }) => {
  const id = roomId()
  const sockets: WebSocket[] = []
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket('ws://127.0.0.1:3000/signal')
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ t: 'join', payload: { roomId: id, name: `Filler${i}` } }))
        resolve()
      })
      ws.addEventListener('error', () => reject(new Error('ws failed')))
    })
  }

  const ninth = await newPeer(browser, 'Ninth')
  await ninth.page.goto(`/room/${id}`)
  await passJoinGate(ninth.page)
  await expect(ninth.page.getByText(/room full/i)).toBeVisible({ timeout: 10000 })

  await ninth.ctx.close()
  for (const ws of sockets) ws.close()
})
