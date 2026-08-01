// Brand asset generator.
// Renders public/favicon.svg + scripts/assets/og-image.svg into all required
// PNG sizes, builds favicon.ico and writes site.webmanifest.
// Usage: bun run generate:assets

import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'public')
mkdirSync(publicDir, { recursive: true })

function out(name) {
  return resolve(publicDir, name)
}

const faviconSvg = readFileSync(resolve(publicDir, 'favicon.svg'))

// ─── PNG renders ──────────────────────────────────────────────────────────────
const sizes = [16, 32, 48, 180, 192, 512]
for (const size of sizes) {
  const name = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`
  await sharp(faviconSvg).resize(size, size).png().toFile(out(name))
  console.log(`✓ ${name} (${size}x${size})`)
}

// ─── OG image (fonts embedded) ────────────────────────────────────────────────
const regular = readFileSync(resolve(root, 'scripts/assets/fonts/JetBrainsMono-Regular.ttf'))
const bold = readFileSync(resolve(root, 'scripts/assets/fonts/JetBrainsMono-Bold.ttf'))
const ogSvg = readFileSync(resolve(root, 'scripts/assets/og-image.svg'), 'utf8')
  .replace('__FONT_REGULAR__', regular.toString('base64'))
  .replace('__FONT_BOLD__', bold.toString('base64'))
await sharp(Buffer.from(ogSvg)).png().toFile(out('og-image.png'))
console.log('✓ og-image.png (1200x630)')

// ─── favicon.ico (PNG-compressed 32px) ───────────────────────────────────────
const png32 = await sharp(faviconSvg).resize(32, 32).png().toBuffer()
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry.writeUInt8(32, 0)
entry.writeUInt8(32, 1)
entry.writeUInt8(0, 2)
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png32.length, 8)
entry.writeUInt32LE(22, 12)
writeFileSync(out('favicon.ico'), Buffer.concat([header, entry, png32]))
console.log('✓ favicon.ico (32x32)')

// ─── Web app manifest ─────────────────────────────────────────────────────────
const manifest = {
  name: 'PeerCall',
  short_name: 'PeerCall',
  description: 'Privacy-first peer-to-peer video calling. No servers, no accounts, no compromise.',
  start_url: '/',
  display: 'standalone',
  background_color: '#0d0d0f',
  theme_color: '#0d0d0f',
  icons: [
    { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}
writeFileSync(out('site.webmanifest'), JSON.stringify(manifest, null, 2))
console.log('✓ site.webmanifest')
