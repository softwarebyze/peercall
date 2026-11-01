import { expect, test } from 'bun:test'
import { resolvePublicOrigin } from './publicOrigin'

test('social URLs use the configured custom domain or the current Fly app', () => {
  expect(resolvePublicOrigin('https://calls.example.com/', 'peercall-pr-7', 'http://internal:8080')).toBe('https://calls.example.com')
  expect(resolvePublicOrigin(undefined, 'peercall-pr-7', 'http://internal:8080')).toBe('https://peercall-pr-7.fly.dev')
  expect(resolvePublicOrigin(undefined, 'peercall', 'http://internal:8080')).toBe('https://peercall.fly.dev')
  expect(resolvePublicOrigin(undefined, undefined, 'http://localhost:3000')).toBe('http://localhost:3000')
})
test('public origin configuration rejects paths and non-HTTP URLs', () => {
  for (const value of ['https://example.com/path', 'javascript:alert(1)', 'https://user:password@example.com']) {
    expect(() => resolvePublicOrigin(value, undefined, 'http://localhost:3000')).toThrow()
  }
})
