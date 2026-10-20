import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos, waitUntilConnected } from './helpers'

test.describe('screen share layout', () => {
  test('a shared screen takes the stage for everyone while the rest stay in a filmstrip', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const id = roomId()

    const alice = await newPeer(browser, 'Alice')
    await alice.page.goto(`/room/${id}?host=1`)
    await passJoinGate(alice.page)
    await waitUntilConnected(alice.page)

    const bob = await newPeer(browser, 'Bob')
    await bob.page.goto(`/room/${id}`)
    await passJoinGate(bob.page)
    await waitUntilConnected(bob.page)

    const carol = await newPeer(browser, 'Carol')
    await carol.page.goto(`/room/${id}`)
    await passJoinGate(carol.page)
    await waitUntilConnected(carol.page)

    await waitForPlayingVideos(alice.page, 3)
    await expect(alice.page.locator('[data-layout="grid-2x2"]')).toBeVisible()

    await alice.page.getByTitle('Share screen').click()
    await expect(alice.page.getByTitle('Stop sharing')).toBeVisible()

    // The presenter is spotlighted for the sharer and for everyone else.
    for (const page of [alice.page, bob.page, carol.page]) {
      await expect(page.locator('[data-layout="spotlight"]')).toBeVisible()
      await expect(page.locator('[data-variant="stage"]')).toHaveCount(1)
      await expect(page.locator('[data-sharing="true"]')).toHaveCount(1)
      await expect(page.getByText('Presenting')).toBeVisible()
      await expect(page.locator('[data-variant="strip"]')).toHaveCount(2)
    }

    await alice.page.getByTitle('Stop sharing').click()
    await expect(bob.page.locator('[data-layout="grid-2x2"]')).toBeVisible()

    for (const peer of [alice, bob, carol]) await peer.ctx.close()
  })

  test('two sharers split the stage so the second screen is not a thumbnail', async ({ browser }) => {
    test.setTimeout(90_000)
    const id = roomId()

    const alice = await newPeer(browser, 'Alice')
    await alice.page.goto(`/room/${id}?host=1`)
    await passJoinGate(alice.page)
    await waitUntilConnected(alice.page)

    const bob = await newPeer(browser, 'Bob')
    await bob.page.goto(`/room/${id}`)
    await passJoinGate(bob.page)
    await waitUntilConnected(bob.page)

    const carol = await newPeer(browser, 'Carol')
    await carol.page.goto(`/room/${id}`)
    await passJoinGate(carol.page)
    await waitUntilConnected(carol.page)

    await waitForPlayingVideos(alice.page, 3)
    await expect(alice.page.locator('[data-layout="grid-2x2"]')).toBeVisible()

    await alice.page.getByTitle('Share screen').click()
    await expect(alice.page.getByTitle('Stop sharing')).toBeVisible()
    await bob.page.getByTitle('Share screen').click()
    await expect(bob.page.getByTitle('Stop sharing')).toBeVisible()

    for (const page of [alice.page, bob.page, carol.page]) {
      const stage = page.locator('[data-layout="shares"]')
      await expect(stage).toBeVisible()
      // Both shares are on the stage, each labeled with its owner.
      const shareTiles = page.locator('[data-layout="shares"]').locator('[data-variant="stage"]')
      await expect(shareTiles).toHaveCount(2)
      await expect(page.locator('[data-layout="shares"]').locator('[data-sharing="true"]')).toHaveCount(2)
      await expect(page.getByText('Presenting')).toHaveCount(2)
      // Carol is not sharing, so she is the only one left in the filmstrip.
      await expect(page.locator('[data-variant="strip"]')).toHaveCount(1)

      // Side by side on a landscape window, not stacked or cropped to a sliver.
      const boxes = await shareTiles.evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }),
      )
      expect(boxes).toHaveLength(2)
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(4)
      expect(Math.abs(boxes[0].x - boxes[1].x)).toBeGreaterThan(100)
      expect(boxes[0].width).toBeGreaterThan(boxes[0].height)
    }

    // Stopping one share falls back to the single-presenter spotlight.
    await bob.page.getByTitle('Stop sharing').click()
    await expect(alice.page.locator('[data-layout="spotlight"]')).toBeVisible()
    await expect(alice.page.locator('[data-variant="stage"]')).toHaveCount(1)

    for (const peer of [alice, bob, carol]) await peer.ctx.close()
  })
})
