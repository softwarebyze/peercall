import { type Browser, type BrowserContext, type Page } from '@playwright/test'

export async function newPeer(
  browser: Browser,
  name: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  await ctx.addInitScript(`localStorage.setItem('peercall_name', ${JSON.stringify(name)})`)
  const page = await ctx.newPage()
  return { ctx, page }
}

export async function passJoinGate(page: Page): Promise<void> {
  const join = page.getByRole('button', { name: 'Join call' })
  try {
    await join.waitFor({ state: 'visible', timeout: 8000 })
    await join.click({ timeout: 20000 })
  } catch {
    // Already in the room (rejoin).
  }
}

export function overlayVisible(page: Page): Promise<boolean> {
  return page
    .getByText(/Connecting to signaling|Waking the server|Signaling dropped/i)
    .first()
    .isVisible()
    .catch(() => false)
}

export async function waitUntilConnected(page: Page, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await overlayVisible(page))) return
    await page.waitForTimeout(200)
  }
  throw new Error('Still on the signaling overlay')
}

export async function playingVideoCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0 && !v.paused).length,
  )
}

export async function waitForPlayingVideos(
  page: Page,
  count: number,
  timeoutMs = 20000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await playingVideoCount(page)) >= count) return
    await page.waitForTimeout(250)
  }
  throw new Error(`Expected ${count} playing video(s)`)
}

export function roomId(): string {
  return `e2e${crypto.randomUUID().slice(0, 8)}`
}
