import { expect, test } from '@playwright/test'

test.describe('landing', () => {
  test('shows a short start CTA and join-existing path', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /No servers/i })).toBeVisible()
    await expect(page.getByText('Name shown to others')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start call' })).toBeDisabled()
    await expect(page.getByTestId('join-link-input')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Scan QR code to join' })).toBeVisible()
    await page.getByPlaceholder('Name').fill('Ada')
    await expect(page.getByRole('button', { name: 'Start call' })).toBeEnabled()
  })

  test('start call opens a lobby, then the live room', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Name').fill('Ada')
    await page.getByRole('button', { name: 'Start call' }).click()
    await expect(page).toHaveURL(/\/room\/[a-z]+-[a-z]+-[a-z]+\?host=1\b/)
    await expect(page.getByTestId('lobby')).toBeVisible()
    await expect(page.getByLabel('Name shown to others')).toHaveValue('Ada')
    await page.getByRole('button', { name: 'Join call' }).click()
    await expect(page.getByTitle('Leave call')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('invite-card')).toBeVisible()
  })

  test('paste invite joins as an invitee through the lobby', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Name').fill('Ben')
    await page.getByTestId('join-link-input').fill('/room/invite-room-1')
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page).toHaveURL(/\/room\/invite-room-1/)
    await expect(page.getByTestId('lobby')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ready?' })).toBeVisible()
    await expect(page.getByLabel('Name shown to others')).toHaveValue('Ben')
    await page.getByRole('button', { name: 'Join call' }).click()
    await expect(page.getByTitle('Leave call')).toBeVisible({ timeout: 20000 })
  })
})
