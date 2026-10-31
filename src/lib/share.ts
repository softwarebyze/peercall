/** Native share-sheet helper for room invites.
 *
 * This is deliberately separate from copying: Copy invite is its own
 * button, always available alongside Share. So this helper never falls
 * back to the clipboard — if the OS share sheet is unavailable, or the
 * share fails, it reports 'unavailable' and the caller points the user
 * at the Copy button instead. A dismissed sheet is not an error: it
 * just returns 'cancelled'.
 */

export type ShareInviteResult = 'shared' | 'cancelled' | 'unavailable'

export interface ShareDataLike {
  title?: string
  text?: string
  url?: string
}

export interface ShareNavigatorLike {
  share?: (data: ShareDataLike) => Promise<void>
  canShare?: (data: ShareDataLike) => boolean
}

function defaultNavigator(): ShareNavigatorLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator as unknown as ShareNavigatorLike
}

export async function shareInvite(args: {
  url: string
  roomId: string
  navigator?: ShareNavigatorLike
}): Promise<ShareInviteResult> {
  const nav = args.navigator ?? defaultNavigator()

  if (!nav || typeof nav.share !== 'function') return 'unavailable'
  if (nav.canShare && !nav.canShare({ url: args.url })) return 'unavailable'

  try {
    await nav.share({
      title: 'PeerCall',
      text: `Join my PeerCall room ${args.roomId}`,
      url: args.url,
    })
    return 'shared'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
    return 'unavailable'
  }
}
