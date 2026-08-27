import { Link, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '0.75rem' }}>
      <h1 className="accent" style={{ fontSize: '2rem', margin: 0 }}>404</h1>
      <p className="dim">Page not found.</p>
      <Link to="/" className="btn-primary" style={{ marginTop: '0.5rem' }}>Go home</Link>
    </div>
  )
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
