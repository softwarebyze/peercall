// Reproduction / verification harness for PeerCall reliability issues.
// Usage: bun run scripts/demo/repro.ts <label>
//   <label> = folder name under demo-artifacts/ (e.g. "before", "after")
//
// Requires the Vite dev server on :3000. This script manages its own
// signaling server on :8080 so it can kill/restart it mid-call.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'

const label = process.argv[2] ?? 'before'
const OUT = `demo-artifacts/${label}`
mkdirSync(OUT, { recursive: true })

const BASE = 'http://localhost:3000'
const results: Record<string, unknown> = {}

// ─── signaling server lifecycle ──────────────────────────────────────────────
// Override with e.g. SIGNAL_CMD="../peercall-go-signal/go-signal/go-signal"
// to run the same suite against an alternative signaling server.
const SIGNAL_CMD = (process.env.SIGNAL_CMD ?? 'bun run signal/index.ts').split(' ')
let signalProc: ChildProcess | null = null

function startSignal(): Promise<void> {
  signalProc = spawn(SIGNAL_CMD[0], SIGNAL_CMD.slice(1), { stdio: 'ignore' })
  return new Promise((resolve) => setTimeout(resolve, 800))
}

function killSignal(): Promise<void> {
  return new Promise((resolve) => {
    if (!signalProc) return resolve()
    signalProc.on('exit', () => resolve())
    signalProc.kill('SIGKILL')
    signalProc = null
    setTimeout(resolve, 500)
  })
}

// ─── helpers ─────────────────────────────────────────────────────────────────
async function newPeer(
  browser: Browser,
  name: string,
  opts: { blockMedia?: boolean } = {}
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  await ctx.addInitScript(`localStorage.setItem('peercall_name', ${JSON.stringify(name)})`)
  if (opts.blockMedia) {
    await ctx.addInitScript(
      `navigator.mediaDevices.getUserMedia = () => new Promise(() => {})`
    )
  }
  const page = await ctx.newPage()
  return { ctx, page }
}

// Invitees may see a name-confirmation gate before entering the room.
async function passJoinGate(page: Page): Promise<void> {
  const join = page.getByRole('button', { name: 'Join', exact: true })
  try {
    await join.waitFor({ state: 'visible', timeout: 5000 })
    await join.click()
  } catch {
    // No gate (e.g. host) — proceed.
  }
}

async function visibleVideoCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].filter((v) => {
      const r = v.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).length
  )
}

async function playingVideoCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].filter(
      (v) => v.videoWidth > 0 && !v.paused
    ).length
  )
}

function waitFor(fn: () => Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (Date.now() < deadline) {
      if (await fn()) return true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return false
  })()
}

const overlayVisible = (page: Page) =>
  page
    .getByText(/Connecting to signaling|Waking the server|Signaling dropped|Waking up|Reconnecting/i)
    .first()
    .isVisible()
    .catch(() => false)

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  await startSignal()

  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium', // full Chrome "new headless" — the headless shell has no fake media support
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  // ── Demo 1: join latency + missing-peer UI ────────────────────────────────
  console.log('\n=== Demo 1: join latency (Alice hosts, Cara joins) ===')
  const room1 = `demo1-${Date.now()}`
  const alice = await newPeer(browser, 'Alice')
  const t0 = Date.now()
  await alice.page.goto(`${BASE}/room/${room1}?host=1`)
  await waitFor(async () => !(await overlayVisible(alice.page)), 15000)
  const tSignal = Date.now() - t0
  await waitFor(async () => (await playingVideoCount(alice.page)) >= 1, 15000)
  const tLocalMedia = Date.now() - t0
  console.log(`Alice: signaling connected in ${tSignal}ms, local video in ${tLocalMedia}ms`)

  const cara = await newPeer(browser, 'Cara')
  const t1 = Date.now()
  await cara.page.goto(`${BASE}/room/${room1}`)
  await passJoinGate(cara.page)
  const gotRemote = await waitFor(
    async () => (await playingVideoCount(alice.page)) >= 2,
    20000
  )
  const tRemote = Date.now() - t1
  console.log(
    gotRemote
      ? `Alice sees Cara's video ${tRemote}ms after Cara navigated`
      : `Alice NEVER saw Cara's video within 20s`
  )
  results.demo1 = { signalMs: tSignal, localMediaMs: tLocalMedia, remoteVisible: gotRemote, remoteMs: tRemote }

  // ── Demo 2: peer in room but invisible in grid (media blocked) ────────────
  console.log('\n=== Demo 2: Bob joins but his camera never starts ===')
  const bob = await newPeer(browser, 'Bob', { blockMedia: true })
  await bob.page.goto(`${BASE}/room/${room1}`)
  await passJoinGate(bob.page)
  await bob.page.waitForTimeout(4000)
  // Open participants panel on Alice's screen
  await alice.page.getByTitle('Participants').click().catch(() => {})
  await alice.page.waitForTimeout(500)
  const participantCount = await alice.page
    .locator('[class*="participantRow"]')
    .count()
    .catch(() => -1)
  const gridTiles = await alice.page.locator('[class*="tileLabel"]').count()
  const avatarTiles = await alice.page.locator('[class*="noVideo"]').count()
  console.log(
    `Alice's view: ${participantCount} participants in list, ${gridTiles} grid tiles, ${avatarTiles} avatar tiles`
  )
  const bobHasTile = gridTiles >= participantCount
  console.log(
    bobHasTile
      ? 'OK: every participant has a tile (video or avatar)'
      : `BUG: Bob is in the participants list but has NO tile in the grid`
  )
  await alice.page.screenshot({ path: `${OUT}/demo2-alice-view-bob-invisible.png` })
  results.demo2 = { participantCount, gridTiles, avatarTiles, bobHasTile }
  await alice.page.getByTitle('Participants').click().catch(() => {})
  await bob.ctx.close()
  await alice.page.waitForTimeout(1000)

  // ── Demo 3: camera off → black tile instead of avatar ─────────────────────
  console.log('\n=== Demo 3: Alice turns her camera off ===')
  await alice.page.getByTitle('Turn off camera').click()
  await alice.page.waitForTimeout(1000)
  const avatarsAfterCamOff = await alice.page.locator('[class*="noVideo"]').count()
  console.log(
    avatarsAfterCamOff > 0
      ? 'OK: avatar shown when camera is off'
      : 'BUG: camera off shows a black video tile, no avatar'
  )
  await alice.page.screenshot({ path: `${OUT}/demo3-camera-off.png` })
  results.demo3 = { avatarShownWhenCameraOff: avatarsAfterCamOff > 0 }
  await alice.page.getByTitle('Turn on camera').click().catch(() => {})

  // ── Demo 4: signaling server drops mid-call ───────────────────────────────
  console.log('\n=== Demo 4: signaling server restarts mid-call ===')
  await killSignal()
  await alice.page.waitForTimeout(2000)
  const stuckOverlay = await overlayVisible(alice.page)
  console.log(`After server death: overlay shown = ${stuckOverlay}`)
  await alice.page.screenshot({ path: `${OUT}/demo4-server-down.png` })
  await startSignal()
  const recovered = await waitFor(async () => !(await overlayVisible(alice.page)), 15000)
  console.log(
    recovered
      ? 'OK: client reconnected after server came back'
      : 'BUG: server is back but client is stuck on the overlay forever (no reconnect)'
  )
  await alice.page.screenshot({ path: `${OUT}/demo4-server-back-${recovered ? 'recovered' : 'stuck'}.png` })
  results.demo4 = { overlayOnDrop: stuckOverlay, reconnected: recovered }
  await alice.ctx.close()
  await cara.ctx.close()

  // ── Demo 5: host leaves, new host's End Call does nothing ─────────────────
  console.log('\n=== Demo 5: host transfer, then End Call ===')
  const room2 = `demo5-${Date.now()}`
  const hostA = await newPeer(browser, 'HostA')
  await hostA.page.goto(`${BASE}/room/${room2}?host=1`)
  await waitFor(async () => !(await overlayVisible(hostA.page)), 10000)
  const peerB = await newPeer(browser, 'PeerB')
  await peerB.page.goto(`${BASE}/room/${room2}`)
  await passJoinGate(peerB.page)
  const peerC = await newPeer(browser, 'PeerC')
  await peerC.page.goto(`${BASE}/room/${room2}`)
  await passJoinGate(peerC.page)
  await peerC.page.waitForTimeout(3000)
  // Original host leaves → server transfers host to B
  await hostA.ctx.close()
  await peerB.page.waitForTimeout(2000)
  const bSeesEndCall = await peerB.page.getByTitle('End call for all').isVisible().catch(() => false)
  console.log(`PeerB now shows "End Call" button: ${bSeesEndCall}`)
  if (bSeesEndCall) {
    await peerB.page.getByTitle('End call for all').click()
    await peerC.page.waitForTimeout(3000)
    const cUrl = peerC.page.url()
    const cSawEnd =
      new URL(cUrl).pathname === '/' ||
      (await peerC.page.getByText(/call ended/i).first().isVisible().catch(() => false))
    console.log(
      cSawEnd
        ? 'OK: PeerC saw the call end — End Call worked for the transferred host'
        : `BUG: PeerB clicked End Call but PeerC is still in the room (${cUrl})`
    )
    await peerC.page.screenshot({ path: `${OUT}/demo5-c-after-endcall.png` })
    results.demo5 = { bSeesEndCall, endCallWorked: cSawEnd }
  } else {
    results.demo5 = { bSeesEndCall, endCallWorked: false }
  }
  await peerB.ctx.close()
  await peerC.ctx.close()

  // ── Demo 6: room full error is invisible ──────────────────────────────────
  console.log('\n=== Demo 6: 9th person joins a full room ===')
  const room3 = `demo6-${Date.now()}`
  const sockets: WebSocket[] = []
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket('ws://localhost:8080/signal')
    sockets.push(ws)
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', payload: { roomId: room3, name: `Filler${i}` } }))
        resolve()
      }
    })
  }
  await new Promise((r) => setTimeout(r, 500))
  const ninth = await newPeer(browser, 'Ninth')
  await ninth.page.goto(`${BASE}/room/${room3}`)
  await passJoinGate(ninth.page)
  await ninth.page.waitForTimeout(4000)
  const errorShown = await ninth.page
    .getByText(/room full|room is full/i)
    .first()
    .isVisible()
    .catch(() => false)
  console.log(
    errorShown
      ? 'OK: "room full" error is shown to the user'
      : 'BUG: server rejected the join (room full) but the UI shows nothing about it'
  )
  await ninth.page.screenshot({ path: `${OUT}/demo6-room-full.png` })
  results.demo6 = { roomFullErrorShown: errorShown }
  for (const ws of sockets) ws.close()
  await ninth.ctx.close()

  await browser.close()
  await killSignal()

  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
  console.log(`\nArtifacts written to ${OUT}/`)
  console.log(JSON.stringify(results, null, 2))
}

main().catch(async (err) => {
  console.error(err)
  await killSignal()
  process.exit(1)
})
