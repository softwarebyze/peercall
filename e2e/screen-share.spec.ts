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
      await expect(page.getByTestId('filmstrip').locator('[data-tile]')).toHaveCount(2)
    }

    await alice.page.getByTitle('Stop sharing').click()
    await expect(bob.page.locator('[data-layout="grid-2x2"]')).toBeVisible()

    for (const peer of [alice, bob, carol]) await peer.ctx.close()
  })
})
