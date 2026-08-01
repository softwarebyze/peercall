import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '~/styles/global.css'

// Absolute URL used for social meta (og:image must be absolute). Update when a custom domain is set.
const SITE_URL = 'https://peercall.fly.dev'
const SITE_TITLE = 'PeerCall — No servers. No accounts. No compromise.'
const SITE_DESC =
  'Privacy-first peer-to-peer video calling. WebRTC mesh, local recording via MediaBunny, zero media through any server.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: SITE_TITLE },
      { name: 'description', content: SITE_DESC },
      { name: 'theme-color', content: '#0D0D0F' },
      { name: 'color-scheme', content: 'dark' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'PeerCall' },
      { property: 'og:title', content: SITE_TITLE },
      { property: 'og:description', content: SITE_DESC },
      { property: 'og:url', content: `${SITE_URL}/` },
      { property: 'og:image', content: `${SITE_URL}/og-image.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'PeerCall — no servers, no accounts, no compromise' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: SITE_TITLE },
      { name: 'twitter:description', content: SITE_DESC },
      { name: 'twitter:image', content: `${SITE_URL}/og-image.png` },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
      { name: 'apple-mobile-web-app-title', content: 'PeerCall' },
      { name: 'msapplication-TileColor', content: '#0D0D0F' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      { rel: 'canonical', href: `${SITE_URL}/` },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
