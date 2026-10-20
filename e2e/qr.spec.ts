import { expect, test } from '@playwright/test'
import { passJoinGate, roomId } from './helpers'
import sharp from 'sharp'
import jsQR from 'jsqr'

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


test('displayed invite QR decodes to the current join link without inverted-color support', async ({ page }) => {
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
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'dontInvert' })
    expect(decoded?.data).toBe(page.url())
  }
})
