import type { MediaHandoff } from '../hooks/useLocalMedia'

/**
 * Constraints for re-acquiring local media when there is no live handed-off
 * stream — i.e. rejoining a call, or joining with no handoff at all.
 *
 * A handoff that carried no video tracks (an audio-only join) must stay
 * audio-only; otherwise the camera request can be denied or find no device and
 * block the rejoin. `listen` is handled before this is ever called, so it falls
 * back to the permissive default.
 */
export function reacquireConstraints(
  handoff: MediaHandoff | null,
): { video: boolean; audio: boolean } {
  const video = handoff?.kind === 'stream' ? handoff.stream.getVideoTracks().length > 0 : true
  return { video, audio: true }
}

/** The current local track of a kind, or null before that kind is enabled. */
export function findLocalTrack(
  stream: MediaStream | null,
  kind: 'video' | 'audio',
): MediaStreamTrack | null {
  if (!stream) return null
  const tracks = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks()
  return tracks[0] ?? null
}
