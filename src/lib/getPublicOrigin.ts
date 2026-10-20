import { createServerFn } from '@tanstack/react-start'
import { resolvePublicOrigin } from './publicOrigin'

export const getPublicOrigin = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestUrl } = await import('@tanstack/react-start/server')
  return resolvePublicOrigin(process.env.PUBLIC_ORIGIN, process.env.FLY_APP_NAME, getRequestUrl().origin)
})
