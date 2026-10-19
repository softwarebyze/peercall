import { useRef, useEffect, useState } from 'react'
import styles from './Room.module.css'
import { IconMicOff, IconScreen, IconFocus, IconUnfocus } from './Icons'

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
  sinkId?: string | null
  /** Where this tile is rendered — affects fit and chrome. */
  variant?: 'grid' | 'strip' | 'stage'
  /** This participant is sharing their screen. */
  sharing?: boolean
  /** This tile is the one being spotlighted. */
  focused?: boolean
  /** Rendered only when focus can be toggled (not in the lobby). */
  onToggleFocus?: () => void
  /** CSS `grid-column`, so a short last row can be centered. */
  gridColumn?: string
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
  sinkId,
  variant = 'grid',
  sharing = false,
  focused = false,
  onToggleFocus,
  gridColumn,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Force srcObject update when stream reference changes (covers mount + track swap)
  useEffect(() => {
    if (videoRef.current && stream && streamRef.current !== stream) {
      videoRef.current.srcObject = stream
      streamRef.current = stream
    }
  }, [stream])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !sinkId || !('setSinkId' in el)) return
    void el.setSinkId(sinkId).catch(() => {})
  }, [sinkId, stream])

  const remoteVideoMuted = useTrackMuted(isLocal ? null : stream, 'video')
  const remoteAudioMuted = useTrackMuted(isLocal ? null : stream, 'audio')

  const noVideo = !stream || (isLocal ? !!videoOff : remoteVideoMuted)
  const micMuted = isLocal ? !!micOff : remoteAudioMuted
  const showConnectionIssue =
    !isLocal && connectionState && connectionState !== 'connected' && connectionState !== 'closed'

  return (
    <div
      className={`${styles.tile} ${styles[`tile_${variant}`] ?? ''}`}
      data-tile
      data-tile-name={isLocal ? `${name} (you)` : name}
      data-variant={variant}
      data-sharing={sharing ? 'true' : undefined}
      data-focused={focused ? 'true' : undefined}
      style={gridColumn ? { gridColumn } : undefined}
    >
      <video
        ref={videoRef}
        className={variant === 'stage' || sharing ? styles.videoContain : styles.video}
        style={noVideo ? { visibility: 'hidden' } : undefined}
        autoPlay
        playsInline
        muted={isLocal}
      />
      {onToggleFocus && (
        <button
          type="button"
          className={`${styles.focusBtn} ${focused ? styles.focusBtnActive : ''}`}
          onClick={onToggleFocus}
          aria-pressed={focused}
          aria-label={focused ? `Stop focusing ${name}` : `Focus ${name}`}
          title={focused ? 'Stop focusing' : 'Focus this participant'}
        >
          {focused ? <IconUnfocus size={14} /> : <IconFocus size={14} />}
        </button>
      )}
      {noVideo && (
        <div className={styles.noVideo}>
          <span className={styles.avatar}>{name.charAt(0).toUpperCase()}</span>
          {!stream && (
            <span className={styles.connectionBadge}>
              {showConnectionIssue
                ? (stateLabel[connectionState!] ?? connectionState)
                : 'Waiting for camera…'}
            </span>
          )}
          {stream && (isLocal ? videoOff : remoteVideoMuted) && (
            <span className={styles.connectionBadge}>Camera off</span>
          )}
        </div>
      )}
      {stream && !noVideo && showConnectionIssue && (
        <div className={styles.connectionOverlay}>
          <span>{stateLabel[connectionState!] ?? connectionState}</span>
        </div>
      )}
      <div className={styles.tileLabel}>
        {sharing && (
          <span className={styles.presentBadge} title="Sharing their screen">
            <IconScreen size={12} /> Presenting
          </span>
        )}
        <span>{isLocal ? `${name} (you)` : name}</span>
        {micMuted && stream && (
          <span className={styles.mutedBadge} title="Microphone muted">
            <IconMicOff size={12} />
          </span>
        )}
        {isHost && <span className={styles.hostBadge}>HOST</span>}
      </div>
    </div>
  )
}
