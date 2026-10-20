import { describe, expect, test } from 'bun:test'
import { generateRoomId } from './roomId'

const ID = /^[a-z]+-[a-z]+-[a-z]+-[a-z2-9]{8}$/

function token(id: string): string {
  return id.slice(id.lastIndexOf('-') + 1)
}

describe('generateRoomId', () => {
  test('returns a readable triple plus a random token', () => {
    expect(generateRoomId()).toMatch(ID)
  })

  test('stays within the room-url length budget', () => {
    for (let i = 0; i < 40; i++) {
      const id = generateRoomId()
      expect(id.length).toBeGreaterThanOrEqual(8)
      expect(id.length).toBeLessThanOrEqual(48)
    }
  })

  test('the words alone are not the id', () => {
    // The triple is only 32^3 combinations; without the token every room is
    // guessable, so the token has to be actual entropy and not a repeat.
    const ids = Array.from({ length: 500 }, () => generateRoomId())
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids.map(token)).size).toBe(ids.length)
  })

  test('tokens avoid characters that are misread out loud', () => {
    const ids = Array.from({ length: 200 }, () => generateRoomId())
    for (const id of ids) expect(token(id)).not.toMatch(/[ilou01]/)
  })
})
