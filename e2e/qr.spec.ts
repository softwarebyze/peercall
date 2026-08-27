import { expect, test } from '@playwright/test'
import { roomId } from './helpers'

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
  await expect(page.getByRole('heading', { name: 'Enter your name' })).toBeVisible()
})
