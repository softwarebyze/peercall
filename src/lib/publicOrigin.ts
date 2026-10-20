/** Prefer deployment configuration; request origin is the local/dev fallback. */
export function resolvePublicOrigin(configured: string | undefined, flyApp: string | undefined, requestOrigin: string) {
  const value = configured || (flyApp ? `https://${flyApp}.fly.dev` : requestOrigin)
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path, credentials, query, or fragment')
  }
  return url.origin
}
