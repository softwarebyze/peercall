import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos } from './helpers'

test('enlarging changes only the local layout and keeps media elements mounted', async ({ browser }) => {
  const id = roomId()
  const alice = await newPeer(browser, 'Alice')
  const bob = await newPeer(browser, 'Bob')
  await alice.page.goto(`/room/${id}?host=1`)
  await passJoinGate(alice.page)
  await bob.page.goto(`/room/${id}`)
  await passJoinGate(bob.page)
  await waitForPlayingVideos(alice.page, 2)
  await alice.page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')]
    Object.assign(window, { __mediaBefore: videos.map(video => ({ video, stream: video.srcObject })) })
  })
  await alice.page.getByLabel('Focus Bob', { exact: true }).click()
  await expect(alice.page.locator('[data-layout="spotlight"]')).toBeVisible()
  await expect(bob.page.locator('[data-layout^="grid-"]')).toBeVisible()
  await alice.page.getByLabel('Stop focusing Bob').click()
  expect(await alice.page.evaluate(() => {
    const before = (window as unknown as { __mediaBefore: { video: HTMLVideoElement; stream: MediaProvider | null }[] }).__mediaBefore
    return before.every(({ video, stream }) => video.isConnected && video.srcObject === stream && !video.paused)
  })).toBe(true)
  await expect(alice.page.getByTestId('peer-audio-level')).toHaveCount(2)
  for (const peer of [alice, bob]) await peer.ctx.close()
})

test('screen-share cycles reuse the camera and leaving stops every captured track', async ({ browser }) => {
  const alice = await newPeer(browser, 'Alice')
  await alice.page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = []
    Object.assign(window, { __capturedTracks: tracks, __cameraCaptures: 0 })
    const md = navigator.mediaDevices
    const gum = md.getUserMedia.bind(md)
    md.getUserMedia = async c => {
      if (c?.video) (window as unknown as {__cameraCaptures: number}).__cameraCaptures++
      const s = await gum(c); tracks.push(...s.getTracks()); return s
    }
    const display = md.getDisplayMedia.bind(md)
    md.getDisplayMedia = async c => { const s = await display(c); tracks.push(...s.getTracks()); return s }
  })
  await alice.page.goto(`/room/${roomId()}?host=1`)
  await passJoinGate(alice.page)
  await waitForPlayingVideos(alice.page, 1)
  for (let i = 0; i < 2; i++) {
    await alice.page.getByTitle('Share screen', { exact: true }).click()
    await expect(alice.page.getByTitle('Stop sharing')).toBeVisible()
    await alice.page.getByTitle('Stop sharing').click()
    await expect(alice.page.getByTitle('Share screen', { exact: true })).toBeVisible()
    await waitForPlayingVideos(alice.page, 1)
  }
  const cameraCaptures = await alice.page.evaluate(() =>
    (window as unknown as { __cameraCaptures: number }).__cameraCaptures,
  )
  expect(cameraCaptures).toBe(1)
  // Also leave during an active share: the hidden original camera must stop.
  await alice.page.getByTitle('Share screen', { exact: true }).click()
  await expect(alice.page.getByTitle('Stop sharing')).toBeVisible()
  await alice.page.getByTitle('Leave call').click()
  await expect.poll(() => alice.page.evaluate(() =>
    (window as unknown as { __capturedTracks: MediaStreamTrack[] }).__capturedTracks.map(t => t.readyState),
  )).toEqual(['ended', 'ended', 'ended', 'ended', 'ended'])
  await alice.ctx.close()
})

test('a disconnected camera can be retried without leaving or losing the microphone', async ({ browser }) => {
  const alice = await newPeer(browser, 'Alice')
  await alice.page.goto(`/room/${roomId()}?host=1`)
  await passJoinGate(alice.page)
  await waitForPlayingVideos(alice.page, 1)
  await alice.page.evaluate(() => {
    const stream = document.querySelector('video')!.srcObject as MediaStream
    Object.assign(window, { __originalMic: stream.getAudioTracks()[0] })
    const camera = stream.getVideoTracks()[0]
    camera.stop()
    camera.dispatchEvent(new Event('ended'))
  })
  await expect(alice.page.getByText('Camera disconnected.', { exact: false })).toBeVisible()
  await alice.page.getByRole('button', { name: 'Retry camera', exact: true }).click()
  await expect(alice.page.getByText('Camera disconnected.', { exact: false })).toHaveCount(0)
  await waitForPlayingVideos(alice.page, 1)
  expect(await alice.page.evaluate(() => {
    const stream = document.querySelector('video')!.srcObject as MediaStream
    return stream.getAudioTracks()[0] === (window as unknown as { __originalMic: MediaStreamTrack }).__originalMic
      && stream.getAudioTracks()[0].readyState === 'live'
  })).toBe(true)
  // Listen-only must release the microphone too, even if the error only
  // concerned the camera and audio was still working.
  await alice.page.evaluate(() => {
    const camera = (document.querySelector('video')!.srcObject as MediaStream).getVideoTracks()[0]
    camera.stop()
    camera.dispatchEvent(new Event('ended'))
  })
  await alice.page.getByRole('button', { name: 'Listen only', exact: true }).click()
  await expect(alice.page.getByText('Listen-only. Your camera and microphone stay off.')).toBeVisible()
  expect(await alice.page.evaluate(() =>
    (window as unknown as {__originalMic: MediaStreamTrack}).__originalMic.readyState,
  )).toBe('ended')
  await alice.ctx.close()
})

test('join links have invite metadata and mobile fields do not trigger Safari focus zoom', async ({ page }) => {
  await page.goto(`/room/${roomId()}`)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /invited/)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-join\.png/)
  const origin = new URL(page.url()).origin
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', `${origin}/og-join.png`)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', page.url())
  // Social crawlers need the correct URLs in server HTML, before hydration.
  const html = await (await page.request.get(page.url())).text()
  expect(html).toContain(`${origin}/og-join.png`)
  expect(html).not.toContain('https://peercall.fly.dev/og-join.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const fontSizes = await page.locator('input').evaluateAll(inputs => inputs.map(el => parseFloat(getComputedStyle(el).fontSize)))
  expect(fontSizes.every(size => size >= 16)).toBe(true)
  await expect(page.locator('body')).not.toContainText('DTLS-SRTP')
})

test('retry targets the selected camera and changing to default requires a click', async ({ browser }) => {
  const alice = await newPeer(browser, 'Alice')
  await alice.page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    Object.assign(window, { __cameraRequests: [] as MediaTrackConstraints[], __cameraMissing: false })
    navigator.mediaDevices.getUserMedia = c => {
      const state = window as unknown as {__cameraRequests: (MediaTrackConstraints | boolean)[]; __cameraMissing: boolean}
      if (c?.video) {
        state.__cameraRequests.push(c.video)
        if (state.__cameraMissing && typeof c.video === 'object' && c.video.deviceId) {
          return Promise.reject(new DOMException('Selected camera unplugged', 'NotFoundError'))
        }
      }
      return original(c)
    }
  })
  await alice.page.goto(`/room/${roomId()}?host=1`)
  await passJoinGate(alice.page)
  await waitForPlayingVideos(alice.page, 1)
  const selectedId = await alice.page.evaluate(() => {
    const track = (document.querySelector('video')!.srcObject as MediaStream).getVideoTracks()[0]
    const id = track.getSettings().deviceId
    Object.assign(window, {__cameraMissing: true})
    track.stop()
    track.dispatchEvent(new Event('ended'))
    return id
  })
  await alice.page.getByRole('button', { name: 'Retry camera', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: 'Use default camera', exact: true })).toBeVisible()
  const requests = await alice.page.evaluate(() => (window as unknown as {__cameraRequests: unknown[]}).__cameraRequests)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual({deviceId: {exact: selectedId}})
  await alice.page.getByRole('button', { name: 'Use default camera', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: 'Use default camera', exact: true })).toHaveCount(0)
  await waitForPlayingVideos(alice.page, 1)
  expect(await alice.page.evaluate(() => (window as unknown as {__cameraRequests: unknown[]}).__cameraRequests.at(-1))).toBe(true)
  await alice.ctx.close()
})
