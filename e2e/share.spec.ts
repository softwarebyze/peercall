import { expect, test } from '@playwright/test'
import { passJoinGate } from './helpers'

test('Share button opens the native share sheet with the room link', async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => {
    ;(window as any).__sharedData = null
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: unknown) => {
        ;(window as any).__sharedData = data
      },
    })
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    })
  })
  const page = await ctx.newPage()
  const id = 'share-sheet-room-abcdefgh'
  await page.goto(`/room/${id}`)
  await page.getByLabel('Name shown to others').fill('Share host')
  await passJoinGate(page)

  const inviteCard = page.getByTestId('invite-card')
  await expect(inviteCard).toBeVisible()
  await inviteCard.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(inviteCard.getByRole('button', { name: 'Shared' })).toBeVisible()
  const sharedFromCard = await page.evaluate(() => (window as any).__sharedData)
  expect(sharedFromCard.url).toBe(page.url())

  await page.getByTestId('share-invite').click()
  await expect(page.getByTestId('toast')).toHaveText('Invite shared')
  const sharedFromTopBar = await page.evaluate(() => (window as any).__sharedData)
  expect(sharedFromTopBar.url).toBe(page.url())

  await ctx.close()
})
