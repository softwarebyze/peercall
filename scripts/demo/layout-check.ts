// Run after `bun run build` and starting `bun run server.ts` on port 3000.
// Uses real WebRTC between three browsers and deterministic canvas screen sources.
import { chromium, type Page } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ channel: 'chromium', args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
] })
const pages: Page[] = []
const room = `layout-${Date.now()}`
async function waitFor(page: Page, check: () => boolean) {
  await page.waitForFunction(check, undefined, { timeout: 20000 })
}
try {
  for (const [i, name] of ['Alice', 'Bob', 'Carol'].entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera', 'microphone'] })
    await ctx.addInitScript(({ name, color }) => {
      localStorage.setItem('peercall_name', name)
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1920; canvas.height = 1080
        const draw = () => {
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = color; ctx.fillRect(0, 0, 1920, 1080)
        }
        draw()
        const timer = setInterval(draw, 33)
        const stream = canvas.captureStream(30)
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer))
        return stream
      }
    }, { name, color: i === 0 ? '#ff0000' : '#00ff00' })
    const page = await ctx.newPage()
    pages.push(page)
    await page.goto(`http://127.0.0.1:3000/room/${room}${i === 0 ? '?host=1' : ''}`)
    if (i > 0) await page.getByRole('button', { name: 'Join', exact: true }).click()
    await waitFor(page, () => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0 && !v.paused))
  }
  for (const page of pages) await waitFor(page, () => [...document.querySelectorAll('video')].filter(v => v.videoWidth > 0 && !v.paused).length === 3)
  assert.equal(await pages[0].locator('[data-layout="grid-2x2"]').count(), 1)
  await pages[0].getByTitle('Share screen').click()
  for (const page of pages) {
    await page.locator('[data-layout="spotlight"]').waitFor()
    assert.equal(await page.locator('[data-variant="stage"]').count(), 1)
    assert.equal(await page.locator('[data-testid="filmstrip"] [data-tile]').count(), 2)
    await waitFor(page, () => {
      const video = document.querySelector<HTMLVideoElement>('[data-variant="stage"] video')!
      const c = document.createElement('canvas'); c.width = c.height = 1
      const ctx = c.getContext('2d')!; ctx.drawImage(video, 0, 0, 1, 1)
      const [r, g] = ctx.getImageData(0, 0, 1, 1).data
      return r > 200 && g < 50
    })
    assert.equal(await page.locator('[data-variant="stage"] video').evaluate(v => getComputedStyle(v).objectFit), 'contain')
  }
  console.log('PASS: single share takes stage on all three peers, actual red screen arrives, no cropping.')
  await pages[1].getByTitle('Share screen').click()
  for (const page of pages) {
    await page.locator('[data-layout="shares"]').waitFor()
    assert.equal(await page.locator('[data-variant="stage"]').count(), 2)
    assert.equal(await page.locator('[data-testid="filmstrip"] [data-tile]').count(), 1)
    const boxes = await page.locator('[data-variant="stage"]').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} }))
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 4)
    assert.ok(Math.abs(boxes[0].x - boxes[1].x) > 100)
  }
  console.log('PASS: two shares split the stage on every peer.')
  await pages[2].setViewportSize({width: 390, height: 844})
  await pages[2].waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-variant="stage"]')]
    return els.length === 2 && Math.abs(els[0].getBoundingClientRect().x - els[1].getBoundingClientRect().x) < 4 && Math.abs(els[0].getBoundingClientRect().y - els[1].getBoundingClientRect().y) > 100
  })
  console.log('PASS: shares stack on a narrow portrait viewport.')
  await pages[1].getByTitle('Stop sharing').click()
  for (const page of pages) await page.locator('[data-layout="spotlight"]').waitFor()
  await pages[0].getByTitle('Stop sharing').click()
  for (const page of pages) {
    await page.locator('[data-layout^="grid-"]').waitFor()
    assert.equal(await page.locator('[data-sharing="true"]').count(), 0)
  }
  console.log('PASS: stopping shares restores spotlight, then the participant grid.')
} finally {
  await browser.close()
}
