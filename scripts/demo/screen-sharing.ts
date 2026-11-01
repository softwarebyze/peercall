// Real Chromium/WebRTC regression check. Run with Vite :3000 and signaling :8080:
// bun run scripts/demo/screen-sharing.ts
import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright'

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const room = `screen-check-${Date.now()}`

async function join(name: string, host = false) {
  const context = await browser.newContext()
  await context.addInitScript((name) => {
    localStorage.setItem('peercall_name', name)
    const NativePC = window.RTCPeerConnection
    const pcs: RTCPeerConnection[] = []
    Object.assign(window, { testPCs: pcs, testOffers: 0 })
    const draws = { screen: 0, inset: 0 }
    Object.assign(window, { testRecordingDraws: draws })
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const source = args[0]
      if (source instanceof HTMLVideoElement && !source.isConnected && source.srcObject instanceof MediaStream) {
        const track = source.srcObject.getVideoTracks()[0]
        if (track?.getSettings().displaySurface) draws.screen++
        else if (typeof args[3] === 'number' && args[3] < this.canvas.width) draws.inset++
      }
      return Reflect.apply(drawImage, this, args)
    }
    const createOffer = NativePC.prototype.createOffer
    NativePC.prototype.createOffer = function (...args: unknown[]) {
      const state = window as unknown as { testOffers: number }
      state.testOffers++
      return Reflect.apply(createOffer, this, args)
    }
    window.RTCPeerConnection = class extends NativePC {
      constructor(config?: RTCConfiguration) {
        super(config)
        pcs.push(this)
      }
    }
  }, name)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error(`${name}: ${error.message}`))
  await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}/room/${room}${host ? '?host=1' : ''}`)
  await page.getByRole('button', { name: 'Join call', exact: true }).click()
  return page
}

async function playing(page: Page, count: number) {
  await page.waitForFunction((count) => {
    const videos = [...document.querySelectorAll('video')]
    return videos.length === count && videos.every((v) =>
      v.videoWidth > 0 && !v.paused && v.style.visibility !== 'hidden')
  }, count, { timeout: 25_000 })
}

const offers = (page: Page) => page.evaluate(() =>
  (window as unknown as { testOffers: number }).testOffers)

async function senderState(page: Page) {
  return page.evaluate(() => {
    const pcs = (window as unknown as { testPCs: RTCPeerConnection[] }).testPCs
    return pcs.filter((pc) => pc.connectionState === 'connected').map((pc) =>
      pc.getSenders().filter((s) => s.track?.kind === 'video').map((s) => ({
        id: s.track!.id,
        enabled: s.track!.enabled,
        maxBitrate: s.getParameters().encodings[0]?.maxBitrate,
      })))
  })
}

try {
  const alice = await join('Alice', true)
  const bob = await join('Bob')
  await Promise.all([playing(alice, 2), playing(bob, 2)])
  const before = await Promise.all([offers(alice), offers(bob)])
  const cameraId = (await senderState(alice))[0][0].id

  await alice.getByTitle('Share screen', { exact: true }).click()
  await Promise.all([playing(alice, 3), playing(bob, 3)])
  const senders = (await senderState(alice))[0]
  assert.equal(senders.length, 2)
  assert.equal(senders[0].id, cameraId, 'Sharing must preserve the camera track')
  assert.equal(senders[0].maxBitrate, 1_500_000)
  assert.equal(senders[1].maxBitrate, 2_500_000)
  console.log('PASS: camera + screen reach both participants; sender bitrate caps applied')

  await bob.getByTitle('Share screen', { exact: true }).click()
  await Promise.all([playing(alice, 4), playing(bob, 4)])
  console.log('PASS: both participants can share simultaneously')

  await alice.getByTitle('Turn off camera').click()
  assert.equal((await senderState(alice))[0][0].enabled, false)
  assert.equal((await senderState(alice))[0][1].enabled, true)
  await alice.getByTitle('Turn on camera').click()

  const screenId = (await senderState(alice))[0][1].id
  await alice.getByTitle('Device settings').click()
  await alice.locator('[class*="deviceGroup"]').first().getByRole('button').first().click()
  await alice.waitForFunction(({ cameraId, screenId }) => {
    const pcs = (window as unknown as { testPCs: RTCPeerConnection[] }).testPCs
    const pc = pcs.find((pc) => pc.connectionState === 'connected')!
    const videos = pc.getSenders().filter((s) => s.track?.kind === 'video')
    return videos[0].track?.id !== cameraId && videos[1].track?.id === screenId
  }, { cameraId, screenId })
  await alice.getByRole('button', { name: 'Close devices', exact: true }).click()

  await alice.getByTitle('Stop sharing', { exact: true }).click()
  await Promise.all([playing(alice, 3), playing(bob, 3)])
  await alice.getByTitle('Share screen', { exact: true }).click()
  await Promise.all([playing(alice, 4), playing(bob, 4)])
  assert.deepEqual(await Promise.all([offers(alice), offers(bob)]), before,
    'Starting and stopping shares must not renegotiate')
  console.log('PASS: independent camera toggle/device switch and screen restart without renegotiation')

  const cara = await join('Cara')
  await Promise.all([playing(alice, 5), playing(bob, 5), playing(cara, 5)])
  console.log('PASS: late joiner receives both active screen shares and all cameras')

  await alice.getByTitle('Start recording', { exact: true }).click()
  await alice.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await alice.waitForFunction(() => {
    const draws = (window as unknown as { testRecordingDraws: { screen: number; inset: number } }).testRecordingDraws
    return draws.screen > 0 && draws.inset > 0
  })
  assert(await alice.getByRole('button', { name: 'Stop sharing', exact: true }).isVisible())
  await alice.getByTitle('Stop sharing', { exact: true }).click()
  await alice.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await alice.getByTitle('Share screen', { exact: true }).click()
  await Promise.all([playing(alice, 5), playing(bob, 5)])
  const download = alice.waitForEvent('download')
  await alice.getByRole('button', { name: 'Stop recording', exact: true }).click()
  assert.match((await download).suggestedFilename(), /\.mp4$/)
  assert(await alice.getByTitle('Start recording', { exact: true }).isVisible())
  assert(await alice.getByTitle('Stop sharing', { exact: true }).isVisible())
  await alice.getByTitle('Stop sharing', { exact: true }).click()
  console.log('PASS: recording composites screen + camera; both stop controls act independently; MP4 downloads')

  // Simulate the browser's own Stop sharing control by ending its capture track.
  await bob.evaluate(() => {
    const pcs = (window as unknown as { testPCs: RTCPeerConnection[] }).testPCs
    const pc = pcs.find((pc) => pc.connectionState === 'connected')!
    const screen = pc.getSenders().filter((s) => s.track?.kind === 'video')[1].track!
    screen.stop()
    screen.dispatchEvent(new Event('ended'))
  })
  await Promise.all([playing(alice, 3), playing(bob, 3), playing(cara, 3)])
  console.log('PASS: browser capture ending removes screen tiles and preserves cameras')
} finally {
  await browser.close()
}
