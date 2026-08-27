import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos, waitUntilConnected } from './helpers'

test.describe('in-call', () => {
  test('two peers join, mute, camera, chat, screenshot, devices, leave and rejoin', async ({
    browser,
  }) => {
    const id = roomId()
    const alice = await newPeer(browser, 'Alice')
    await alice.page.goto(`/room/${id}?host=1`)
    await expect(alice.page.getByTestId('lobby')).toBeVisible()
    await expect(alice.page.getByLabel('Name shown to others')).toHaveValue('Alice')
    await passJoinGate(alice.page)
    await waitUntilConnected(alice.page)
    await waitForPlayingVideos(alice.page, 1)
    await expect(alice.page.getByTestId('invite-card')).toBeVisible()

    await expect(alice.page.getByTestId('mic-meter')).toBeVisible()
    await expect(alice.page.getByTestId('device-readout')).toBeVisible()
    await expect(alice.page.getByRole('button', { name: 'End for everyone' })).toBeVisible()
    await expect(alice.page.getByTitle('Leave call')).toBeVisible()

    const bob = await newPeer(browser, 'Bob')
    await bob.page.goto(`/room/${id}`)
    await expect(bob.page.getByTestId('lobby')).toBeVisible()
    await passJoinGate(bob.page)
    await waitUntilConnected(bob.page)
    await waitForPlayingVideos(alice.page, 2)
    await waitForPlayingVideos(bob.page, 2)
    await expect(alice.page.getByTestId('invite-card')).toHaveCount(0)

    await alice.page.getByTitle('Mute').click()
    await expect(alice.page.getByTitle('Unmute')).toBeVisible()
    await alice.page.getByTitle('Unmute').click()

    await alice.page.getByTitle('Turn off camera').click()
    await expect(alice.page.getByText('Camera off').first()).toBeVisible()
    await alice.page.getByTitle('Turn on camera').click()

    await alice.page.getByTitle('Chat').click()
    await expect(alice.page.getByText('No messages yet.')).toBeVisible()
    await alice.page.getByTestId('copy-invite').click()
    await expect(alice.page.getByRole('button', { name: 'Copied' })).toBeVisible()
    await alice.page.getByPlaceholder('Type a message').fill('hello from alice')
    await alice.page.getByRole('button', { name: 'Send' }).click()
    await expect(alice.page.getByText('hello from alice')).toBeVisible()
    await bob.page.getByTitle('Chat').click()
    await expect(bob.page.getByText('hello from alice')).toBeVisible()
    await expect(bob.page.getByRole('button', { name: 'End for everyone' })).toHaveCount(0)

    const downloadPromise = alice.page.waitForEvent('download')
    await alice.page.getByTitle('Take screenshot').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/peercall-.*\.png/)

    await alice.page.getByTitle('Device settings').click()
    const panel = alice.page.getByTestId('device-panel')
    await expect(panel.getByRole('heading', { name: 'Devices' })).toBeVisible()
    await expect(panel.getByText('Camera', { exact: true })).toBeVisible()
    await expect(panel.getByText('Mic', { exact: true })).toBeVisible()
    const cameraLabels = await panel.locator('button').allTextContents()
    const unique = new Set(cameraLabels.map((l) => l.trim()).filter((l) => l && l !== ''))
    expect(unique.size).toBe(cameraLabels.filter((l) => l.trim()).length)

    await alice.page.getByTitle('Start recording').click()
    await expect(alice.page.getByTestId('rec-pill')).toBeVisible({ timeout: 8000 })

    await alice.page.getByTitle('Leave call').click()
    await expect(alice.page.getByRole('heading', { name: 'You left the call' })).toBeVisible()
    await alice.page.getByRole('button', { name: 'Rejoin' }).click()
    await waitUntilConnected(alice.page)
    await expect(alice.page.getByTitle('Leave call')).toBeVisible()
    await expect(bob.page.getByRole('button', { name: 'End for everyone' })).toBeVisible()

    await bob.page.getByRole('button', { name: 'End for everyone' }).click()
    const confirm = bob.page.getByTestId('end-confirm')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(alice.page.getByTitle('Leave call')).toBeVisible()

    await bob.page.getByRole('button', { name: 'End for everyone' }).click()
    await bob.page.getByTestId('end-confirm').getByRole('button', { name: 'End for everyone' }).click()
    await expect(alice.page.getByRole('heading', { name: 'Call ended' })).toBeVisible()
    await expect(bob.page.getByRole('heading', { name: 'Call ended' })).toBeVisible()

    await bob.ctx.close()
    await alice.ctx.close()
  })
})
