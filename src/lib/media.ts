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

/**
 * The live local track a device switch would replace, or null when the call
 * never published that kind.
 *
 * Device switching is a track swap: `replaceTrack` on a sender that is already
 * publishing that kind. A call that started without a camera (audio-only) has
 * nothing to swap, and publishing a new kind mid-call needs send-side
 * renegotiation this mesh does not do yet — the same reason `shareScreen`
 * refuses in audio-only.
 */
export function findLocalTrack(
  stream: MediaStream | null,
  kind: 'video' | 'audio',
): MediaStreamTrack | null {
  if (!stream) return null
  const tracks = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks()
  return tracks[0] ?? null
}
