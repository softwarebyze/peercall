import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos, waitUntilConnected } from './helpers'

test.describe('device modal', () => {
  test('scrim covers the whole room, including the top bar', async ({ browser }) => {
    test.setTimeout(90_000)
    const id = roomId()
    const alice = await newPeer(browser, 'Alice')
    await alice.page.goto(`/room/${id}?host=1`)
    await passJoinGate(alice.page)
    await waitUntilConnected(alice.page)
    await waitForPlayingVideos(alice.page, 1)

    await alice.page.getByTitle('Device settings').click()
    const panel = alice.page.getByTestId('device-panel')
    await expect(panel).toBeVisible()

    // The overlay must escape .controls, whose z-index creates a stacking
    // context that otherwise traps it beneath .topBar.
    const covered = await alice.page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="device-panel"]')?.parentElement
      const topBar = document
        .querySelector('[data-testid="copy-invite"]')
        ?.closest('div[class]') as HTMLElement | null
      if (!overlay || !topBar) return false

      const r = topBar.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!hit && overlay.contains(hit)
    })

    expect(covered).toBe(true)
    await expect(panel).toBeVisible()
  })
})
