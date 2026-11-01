import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos } from './helpers'

test('signaling keepalives keep a quiet call connected beyond the idle window', async ({ browser }) => {
  const peer = await newPeer(browser, 'Keepalive')
  try {
    await peer.page.clock.install()
    const sockets: import('@playwright/test').WebSocket[] = []
    let pongs = 0
    let joined = false
    peer.page.on('websocket', socket => {
      sockets.push(socket)
      socket.on('framereceived', ({ payload }) => {
        const t = JSON.parse(payload.toString()).t
        if (t === 'pong') pongs++
        if (t === 'joined') joined = true
      })
    })
    await peer.page.goto(`/room/${roomId()}`)
    await passJoinGate(peer.page)
    await expect(peer.page.getByTestId('invite-card')).toBeVisible()
    await expect.poll(() => joined).toBe(true)
    for (let i = 0; i < 7; i++) {
      const before = pongs
      await peer.page.clock.fastForward(20001)
      await expect.poll(() => pongs).toBeGreaterThan(before)
    }
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.isClosed()).toBe(false)
    await expect(peer.page.getByText('Signaling dropped. Reconnecting…')).toHaveCount(0)
  } finally { await peer.ctx.close() }
})

for (const failingSide of ['offerer', 'answerer']) {
  test(`a ${failingSide} failure restarts ICE without replacing connections or video elements`, async ({ browser }) => {
    const alice = await newPeer(browser, 'Alice')
    const bob = await newPeer(browser, 'Bob')
    try {
      for (const peer of [alice, bob]) {
        await peer.ctx.addInitScript(() => {
          const Original = window.RTCPeerConnection
          ;(window as any).__pcs = []
          ;(window as any).__offers = []
          window.RTCPeerConnection = class extends Original {
            constructor(config?: RTCConfiguration) {
              super(config)
              ;(window as any).__pcs.push(this)
              const create = this.createOffer.bind(this)
              this.createOffer = ((options?: RTCOfferOptions) => {
                ;(window as any).__offers.push(options ?? {})
                return create(options)
              }) as typeof this.createOffer
            }
          }
        })
      }
      const id = roomId()
      await alice.page.goto(`/room/${id}`)
      await passJoinGate(alice.page)
      await bob.page.goto(`/room/${id}`)
      await passJoinGate(bob.page)
      for (const peer of [alice, bob]) {
        await waitForPlayingVideos(peer.page, 2)
        await peer.page.evaluate(() => {
          ;(window as any).__beforeUfrag = (window as any).__pcs[0].localDescription.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1]
          ;(window as any).__before = [...document.querySelectorAll('video')].map(video => ({ video, stream: video.srcObject }))
        })
      }
      const aliceOffers = await alice.page.evaluate(() => (window as any).__offers.length)
      const offerer = aliceOffers ? alice : bob
      const answerer = aliceOffers ? bob : alice
      const failed = failingSide === 'offerer' ? offerer : answerer
      await failed.page.evaluate(() => {
        const pc = (window as any).__pcs[0] as RTCPeerConnection
        Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' })
        pc.dispatchEvent(new Event('connectionstatechange'))
        delete (pc as any).connectionState
      })
      await expect.poll(() => offerer.page.evaluate(() => (window as any).__offers.filter((o: RTCOfferOptions) => o.iceRestart).length)).toBe(1)
      for (const peer of [alice, bob]) {
        await expect.poll(() => peer.page.evaluate(() => (window as any).__pcs[0].localDescription.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1] !== (window as any).__beforeUfrag)).toBe(true)
        await expect.poll(() => peer.page.evaluate(() => (window as any).__pcs[0].signalingState)).toBe('stable')
        expect(await peer.page.evaluate(() => (window as any).__pcs.length)).toBe(1)
        expect(await peer.page.evaluate(() => (window as any).__before.every(({ video, stream }: any) => video.isConnected && video.srcObject === stream && !video.paused))).toBe(true)
        await waitForPlayingVideos(peer.page, 2)
      }
    } finally { await Promise.all([alice.ctx.close(), bob.ctx.close()]) }
  })
}
