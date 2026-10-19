import { expect, test } from '@playwright/test'

test.describe('lobby devices', () => {
  test('device settings mark the active camera and mic before joining', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Name').fill('Ada')
    await page.getByRole('button', { name: 'Start call' }).click()
    await expect(page.getByTestId('lobby')).toBeVisible()

    await page.getByTitle('Device settings').click()
    const panel = page.getByTestId('device-panel')
    await expect(panel.getByRole('heading', { name: 'Devices' })).toBeVisible()
    await expect(panel.getByText('Camera', { exact: true })).toBeVisible()
    await expect(panel.getByText('Mic', { exact: true })).toBeVisible()

    // The live stream's ids must have synced into state: the fake device
    // exposes one camera and one mic, so exactly those two options are active.
    await expect(panel.getByRole('button', { pressed: true })).toHaveCount(2)

    await panel.getByLabel('Close devices').click()
    await expect(panel).toHaveCount(0)
  })
})
