import { defineConfig, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

function stamp(): string {
  if (process.env.E2E_STAMP) return process.env.E2E_STAMP
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  let sha = 'local'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // git unavailable
  }
  return `${date}-${sha}`
}

const recordingsDir = `e2e/recordings/${stamp()}`
mkdirSync(recordingsDir, { recursive: true })

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: recordingsDir,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'bun run server.ts',
    url: 'http://127.0.0.1:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
