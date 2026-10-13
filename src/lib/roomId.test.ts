import { describe, expect, test } from 'bun:test'
import { generateRoomId } from './roomId'

describe('generateRoomId', () => {
  test('returns a lowercase word triple', () => {
    const id = generateRoomId()
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  test('stays within the room-url length budget', () => {
    for (let i = 0; i < 40; i++) {
      const id = generateRoomId()
      expect(id.length).toBeGreaterThanOrEqual(8)
      expect(id.length).toBeLessThanOrEqual(48)
    }
  })
})
