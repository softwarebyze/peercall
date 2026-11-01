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

/** A camera that becomes available later can be enabled without rejoining. */
test('an audio-only call can enable a camera while keeping the microphone', async ({ browser }) => {
  const id = roomId()
  const alice = await newPeer(browser, 'Alice')
  const bob = await newPeer(browser, 'Bob')
  await alice.page.addInitScript(() => {
    const md = navigator.mediaDevices
    const original = md.getUserMedia.bind(md)
    let failedVideo = false
    md.getUserMedia = c => {
      if (c?.video && !failedVideo) {
        failedVideo = true
        return Promise.reject(new DOMException('Camera busy', 'NotReadableError'))
      }
      return original(c)
    }
  })
  await alice.page.goto(`/room/${id}?host=1`)
  await passJoinGate(alice.page)
  await bob.page.goto(`/room/${id}`)
  await passJoinGate(bob.page)
  await expect(alice.page.locator('[data-tile-name="Alice (you)"]')).toContainText('Camera off')
  await alice.page.evaluate(() => Object.assign(window, {
    __originalMic: (document.querySelector('video')!.srcObject as MediaStream).getAudioTracks()[0],
  }))
  await alice.page.getByTitle('Device settings').click()
  const panel = alice.page.getByTestId('device-panel')
  await panel.getByTestId('devices-camera').getByRole('button').first().click()
  await panel.getByLabel('Close devices').click()
  await waitForPlayingVideos(alice.page, 2)
  await waitForPlayingVideos(bob.page, 2)
  await expect(bob.page.locator('[data-tile-name="Alice"] video')).toHaveCSS('visibility', 'visible')
  expect(await alice.page.evaluate(() =>
    (document.querySelector('video')!.srcObject as MediaStream).getAudioTracks()[0] ===
    (window as unknown as {__originalMic: MediaStreamTrack}).__originalMic,
  )).toBe(true)
  await expect(alice.page.locator('[data-tile-name="Alice (you)"]')).not.toContainText('Camera off')
  await alice.ctx.close()
  await bob.ctx.close()
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
