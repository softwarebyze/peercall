import { expect, test } from '@playwright/test'

test.describe('landing', () => {
  test('shows a short start CTA and join-existing path', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /No servers/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start call' })).toBeDisabled()
    await expect(page.getByTestId('join-link-input')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Scan QR code to join' })).toBeVisible()
    await page.getByPlaceholder('Name').fill('Ada')
    await expect(page.getByRole('button', { name: 'Start call' })).toBeEnabled()
  })

  test('start call skips the join gate for the host', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Name').fill('Ada')
    await page.getByRole('button', { name: 'Start call' }).click()
    await expect(page).toHaveURL(/\/room\/.+[?&]host=1/)
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0)
    await expect(page.getByText('PeerCall').first()).toBeVisible()
    await expect(page.getByTitle('Leave call')).toBeVisible({ timeout: 20000 })
  })

  test('paste invite joins as an invitee and shows the name gate', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Name').fill('Ben')
    await page.getByTestId('join-link-input').fill('/room/invite-room-1')
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page).toHaveURL(/\/room\/invite-room-1/)
    await expect(page.getByRole('heading', { name: 'Enter your name' })).toBeVisible()
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page.getByTitle('Leave call')).toBeVisible({ timeout: 20000 })
  })
})
