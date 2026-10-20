import { expect, test } from '@playwright/test'
import { passJoinGate, roomId } from './helpers'
import sharp from 'sharp'
import { scanQr } from '../src/lib/scanQr'

test('QR scanner paste path joins a room', async ({ page }) => {
  const id = roomId()
  await page.goto('/')
  await page.getByPlaceholder('Name').fill('Quinn')
  await page.getByRole('button', { name: 'Scan QR code to join' }).click()
  const dialog = page.getByTestId('qr-scanner')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('qr-paste').fill(`${page.url().replace(/\/$/, '')}/room/${id}`)
  await dialog.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/room/${id}`))
  await expect(page.getByTestId('lobby')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready?' })).toBeVisible()
  await expect(page.getByLabel('Name shown to others')).toHaveValue('Quinn')
})


test('displayed invite QR decodes to the current join link with the green-on-dark palette', async ({ page }) => {
  const id = 'gentle-quartz-prairie-abcdefgh'
  await page.goto(`/room/${id}`)
  await page.getByLabel('Name shown to others').fill('QR host')
  await passJoinGate(page)
  const qr = page.getByRole('img', { name: `QR code for room ${id}` })
  await expect(qr).toBeVisible()
  const screenshot = await qr.screenshot()
  // Decode actual browser pixels, including a smaller camera-like image.
  for (const width of [undefined, 160]) {
    const { data, info } = await sharp(screenshot).resize(width).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const decoded = scanQr(new Uint8ClampedArray(data), info.width, info.height)
    expect(decoded).toBe(page.url())
  }
})


test('web camera scanner joins from a green QR and releases its camera', async ({ page }) => {
  const id = 'green-camera-scan-abcdefgh'
  await page.goto(`/room/${id}`)
  await page.getByLabel('Name shown to others').fill('Green scanner')
  await passJoinGate(page)
  const qr = page.getByRole('img', { name: `QR code for room ${id}` })
  const image = (await qr.screenshot()).toString('base64')
  await page.goto('/')
  await page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 640
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0d0d0f'
    ctx.fillRect(0, 0, 640, 640)
    ctx.drawImage(img, (640 - img.width) / 2, (640 - img.height) / 2)
    const stream = canvas.captureStream(10)
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async () => {
      navigator.mediaDevices.getUserMedia = original
      return stream
    }
    ;(window as any).__qrCamera = stream
  }, image)
  await page.getByRole('button', { name: 'Scan QR code to join' }).click()
  await expect(page).toHaveURL(new RegExp(`/room/${id}`))
  await expect(page.getByTestId('lobby')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__qrCamera.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
})

test('closing scanner releases a camera that resolves after close', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const stream = canvas.captureStream()
    ;(window as any).__qrCamera = stream
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
      ;(window as any).__resolveQrCamera = () => resolve(stream)
    })
  })
  await page.getByRole('button', { name: 'Scan QR code to join' }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveQrCamera)).toBe('function')
  await page.getByRole('button', { name: 'Close scanner' }).click()
  await page.evaluate(() => (window as any).__resolveQrCamera())
  await expect.poll(() => page.evaluate(() => (window as any).__qrCamera.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
})
