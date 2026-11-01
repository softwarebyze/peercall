import { useRef, useEffect, useState } from 'react'
import styles from './Room.module.css'

interface VideoTileProps {
  name: string
  stream: MediaStream | null
  isLocal: boolean
  isHost: boolean
  connectionState?: RTCPeerConnectionState
  /** Local-only: we know our own camera state directly. */
  videoOff?: boolean
  /** Local-only: we know our own mic state directly. */
  micOff?: boolean
  /** Override the default name (used for screen-share tiles). */
  label?: string
  /** Screen shares use contain-fit so content isn’t cropped. */
  variant?: 'camera' | 'screen'
  /** Status shown when a tile has no video yet. */
  emptyLabel?: string
}

const stateLabel: Partial<Record<RTCPeerConnectionState, string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  failed: 'Connection failed',
}

/** Track remote video/audio availability: a disabled remote track stops
 * producing frames, which fires `mute` on the receiving side. */
function useTrackMuted(stream: MediaStream | null, kind: 'video' | 'audio'): boolean {
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    if (!stream) {
      setMuted(false)
      return
    }
    const tracks = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks()
    const track = tracks[0]
    if (!track) {
      setMuted(true)
      return
    }
    setMuted(track.muted)
    const onMute = () => setMuted(true)
    const onUnmute = () => setMuted(false)
    track.addEventListener('mute', onMute)
    track.addEventListener('unmute', onUnmute)
    return () => {
      track.removeEventListener('mute', onMute)
      track.removeEventListener('unmute', onUnmute)
    }
  }, [stream, kind])
  return muted
}

export function VideoTile({
  name,
  stream,
  isLocal,
  isHost,
  connectionState,
  videoOff,
  micOff,
  label,
  variant = 'camera',
  emptyLabel,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const isScreen = variant === 'screen'

  // Force srcObject update when stream reference changes (covers mount + track swap)
  useEffect(() => {
    if (videoRef.current && stream && streamRef.current !== stream) {
      videoRef.current.srcObject = stream
      streamRef.current = stream
    }
  }, [stream])

  const remoteVideoMuted = useTrackMuted(isLocal ? null : stream, 'video')
  const remoteAudioMuted = useTrackMuted(isLocal || isScreen ? null : stream, 'audio')

  const noVideo = !stream || (isLocal ? !!videoOff : remoteVideoMuted)
  const micMuted = isLocal ? !!micOff : remoteAudioMuted
  const showConnectionIssue =
    !isLocal && connectionState && connectionState !== 'connected' && connectionState !== 'closed'

  const waitingLabel = isScreen
    ? (emptyLabel ?? 'Waiting for screen…')
    : connectionState && showConnectionIssue
      ? (stateLabel[connectionState] ?? connectionState)
      : 'Waiting for camera…'

  return (
    <div className={`${styles.tile} ${isScreen ? styles.tileScreen : ''}`}>
      <video
        ref={videoRef}
        className={`${styles.video} ${isScreen ? styles.videoScreen : ''}`}
        style={noVideo ? { visibility: 'hidden' } : undefined}
        autoPlay
        playsInline
        muted={isLocal || isScreen}
      />
      {noVideo && (
        <div className={styles.noVideo}>
          <span className={styles.avatar}>{name.charAt(0).toUpperCase()}</span>
          {!stream && <span className={styles.connectionBadge}>{waitingLabel}</span>}
          {stream && (isLocal ? videoOff : remoteVideoMuted) && (
            <span className={styles.connectionBadge}>
              {isScreen ? (emptyLabel ?? 'Waiting for screen…') : 'Camera off'}
            </span>
          )}
        </div>
      )}
      {stream && !noVideo && showConnectionIssue && (
        <div className={styles.connectionOverlay}>
          <span>{stateLabel[connectionState!] ?? connectionState}</span>
        </div>
      )}
      <div className={styles.tileLabel}>
        <span>{label ?? (isLocal ? `${name} (you)` : name)}</span>
        {micMuted && stream && !isScreen && (
          <span className={styles.mutedBadge} title="Microphone muted">
            🎙✕
          </span>
        )}
        {isHost && <span className={styles.hostBadge}>HOST</span>}
      </div>
    </div>
  )
}
