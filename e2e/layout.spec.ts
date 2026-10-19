import { expect, test, type Browser } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos, waitUntilConnected } from './helpers'

async function joinPeers(
  browser: Browser,
  id: string,
  names: string[],
): Promise<Awaited<ReturnType<typeof newPeer>>[]> {
  const peers: Awaited<ReturnType<typeof newPeer>>[] = []
  for (const [index, name] of names.entries()) {
    const peer = await newPeer(browser, name)
    await peer.page.goto(`/room/${id}${index === 0 ? '?host=1' : ''}`)
    await passJoinGate(peer.page)
    await waitUntilConnected(peer.page)
    peers.push(peer)
  }
  return peers
}

test.describe('call layout', () => {
  test('three peers use a 2x2 grid of landscape tiles, not three vertical slivers', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const id = roomId()
    const peers = await joinPeers(browser, id, ['Alice', 'Bob', 'Carol'])
    const host = peers[0].page

    await waitForPlayingVideos(host, 3)

    const grid = host.locator('[data-layout="grid-2x2"]')
    await expect(grid).toBeVisible()
    const tiles = grid.locator('[data-tile]')
    await expect(tiles).toHaveCount(3)

    const boxes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    )
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(box.height)
    }

    for (const peer of peers) await peer.ctx.close()
  })

  test('focusing a participant spotlights them and the others become a filmstrip', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const id = roomId()
    const peers = await joinPeers(browser, id, ['Alice', 'Bob', 'Carol'])
    const host = peers[0].page

    await waitForPlayingVideos(host, 3)
    await expect(host.locator('[data-layout="grid-2x2"]')).toBeVisible()

    await host.getByLabel('Focus Bob').click()

    const spotlight = host.locator('[data-layout="spotlight"]')
    await expect(spotlight).toBeVisible()
    await expect(spotlight.locator('[data-variant="stage"]')).toHaveCount(1)
    const strip = host.getByTestId('filmstrip')
    await expect(strip.locator('[data-tile]')).toHaveCount(2)
    await expect(strip.getByLabel('Focus Alice')).toBeVisible()

    await host.getByLabel('Stop focusing Bob').click()
    await expect(host.locator('[data-layout="grid-2x2"]')).toBeVisible()

    for (const peer of peers) await peer.ctx.close()
  })
})
