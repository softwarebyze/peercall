import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos } from './helpers'

/**
 * Camera/mic acquisition resolving after the lobby unmounted (Back pressed
 * while the permission prompt was up) must not leave the tracks running.
 */
test('a stream that resolves after leaving the gate is stopped', async ({ page }) => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    const original = md.getUserMedia.bind(md)
    const tracks: MediaStreamTrack[] = []
    ;(window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = tracks
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      // Stand in for a slow permission prompt.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const stream = await original(constraints)
      tracks.push(...stream.getTracks())
      return stream
    }
  })

  await page.goto(`/room/${roomId()}`)
  await page.getByRole('link', { name: 'Back' }).click()
  await expect(page.getByPlaceholder('Name')).toBeVisible()

  // Let the pending getUserMedia resolve, then look at what it handed back.
  await page.waitForTimeout(3000)
  const states = await page.evaluate(() =>
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState),
  )
  expect(states.length).toBeGreaterThan(0)
  expect(states).toEqual(states.map(() => 'ended'))
})

/**
 * An audio-only call publishes no camera, and adding a kind mid-call needs
 * send-side renegotiation the mesh does not do yet. The panel must say so and
 * must not offer a switch that can only fail (and used to leak the track).
 */
test('an audio-only call disables camera switching', async ({ page }) => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    const original = md.getUserMedia.bind(md)
    let failedVideo = false
    md.getUserMedia = (constraints?: MediaStreamConstraints) => {
      if (constraints?.video && !failedVideo) {
        failedVideo = true
        const err = new Error('no camera')
        err.name = 'NotFoundError'
        return Promise.reject(err)
      }
      return original(constraints)
    }
  })

  await page.goto('/')
  await page.getByPlaceholder('Name').fill('Ada')
  await page.getByRole('button', { name: 'Start call' }).click()

  // No camera: the lobby falls back to mic-only.
  const tile = page.locator('[data-tile]').first()
  await expect(tile).toContainText('Camera off', { timeout: 15000 })
  await page.getByRole('button', { name: 'Join call' }).click()
  await expect(tile).toContainText('Camera off', { timeout: 15000 })

  await page.getByTitle('Device settings').click()
  const panel = page.getByTestId('device-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/Camera is off for this call/)).toBeVisible()

  const cameraRows = panel.getByTestId('devices-camera').getByRole('button')
  const count = await cameraRows.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) await expect(cameraRows.nth(i)).toBeDisabled()

  // The mic stays switchable — only the missing kind is unavailable.
  await expect(panel.getByTestId('devices-mic').getByRole('button').first()).toBeEnabled()
})

/**
 * The swap path itself: replacing the camera track must keep both sides of the
 * call publishing video (this is what the audio-only guard must not break).
 */
test('switching the camera mid-call keeps publishing video', async ({ browser }) => {
  const id = roomId()
  const alice = await newPeer(browser, 'Alice')
  await alice.page.goto(`/room/${id}?host=1`)
  await passJoinGate(alice.page)
  await waitForPlayingVideos(alice.page, 1)

  const bob = await newPeer(browser, 'Bob')
  await bob.page.goto(`/room/${id}`)
  await passJoinGate(bob.page)
  await waitForPlayingVideos(alice.page, 2)

  await alice.page.getByTitle('Device settings').click()
  const panel = alice.page.getByTestId('device-panel')
  const camera = panel.getByTestId('devices-camera').getByRole('button').first()
  await expect(camera).toBeEnabled()
  await camera.click()
  await panel.getByLabel('Close devices').click()

  await waitForPlayingVideos(alice.page, 2)
  await waitForPlayingVideos(bob.page, 2)
})
