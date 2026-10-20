import { expect, test } from '@playwright/test'
import { newPeer, passJoinGate, roomId, waitForPlayingVideos } from './helpers'

test('remote mute badges and meters follow explicit mute state, including late joiners', async ({ browser }) => {
  test.setTimeout(90000)
  const id = roomId()
  const alice = await newPeer(browser, 'Alice')
  const bob = await newPeer(browser, 'Bob')
  const carol = await newPeer(browser, 'Carol')
  try {
    // A steady tone makes the meter assertions deterministic, including the
    // transition from real activity to silence when track.enabled changes.
    await alice.ctx.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints)
        if (constraints?.audio) {
          const context = new AudioContext()
          const tone = context.createOscillator()
          const output = context.createMediaStreamDestination()
          tone.connect(output)
          tone.start()
          void context.resume()
          stream.getAudioTracks().forEach(t => { stream.removeTrack(t); t.stop() })
          stream.addTrack(output.stream.getAudioTracks()[0]!)
        }
        return stream
      }
    })
    await alice.page.goto(`/room/${id}`)
    await passJoinGate(alice.page)
    await bob.page.goto(`/room/${id}`)
    await passJoinGate(bob.page)
    await waitForPlayingVideos(bob.page, 2)
    const remote = bob.page.locator('[data-tile-name="Alice"]')
    await expect(remote.getByTestId('peer-audio-level')).toHaveAttribute('data-active', 'true')
    await alice.page.getByTitle('Mute', { exact: true }).click()
    await expect(remote.getByTitle('Microphone muted', { exact: true })).toBeVisible()
    await expect(remote.getByTestId('peer-audio-level')).toHaveAttribute('data-active', 'false')
    const samples = await remote.getByTestId('peer-audio-level').evaluate(async el => {
      const values: string[] = []
      for (let i = 0; i < 12; i++) {
        values.push(el.getAttribute('data-active')!, ...[...el.querySelectorAll('i')].map(bar => bar.style.opacity))
        await new Promise(resolve => setTimeout(resolve, 80))
      }
      return values
    })
    expect(samples.every(value => value === 'false' || value === '0.2')).toBe(true)
    await carol.page.goto(`/room/${id}`)
    await passJoinGate(carol.page)
    const lateRemote = carol.page.locator('[data-tile-name="Alice"]')
    await expect(lateRemote.getByTitle('Microphone muted', { exact: true })).toBeVisible()
    await alice.page.getByTitle('Unmute', { exact: true }).click()
    await expect(remote.getByTitle('Microphone muted', { exact: true })).toHaveCount(0)
    await expect(lateRemote.getByTitle('Microphone muted', { exact: true })).toHaveCount(0)
    await expect(remote.getByTestId('peer-audio-level')).toHaveAttribute('data-active', 'true')
  } finally {
    await Promise.all([alice.ctx.close(), bob.ctx.close(), carol.ctx.close()])
  }
})
