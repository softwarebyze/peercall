import { useRef, useEffect } from 'react'
import styles from './Room.module.css'

interface VideoTileProps {
  name: string
  stream: MediaStream | null
  isLocal: boolean
  isHost: boolean
  connectionState?: RTCPeerConnectionState
}

const stateLabel: Partial<Record<RTCPeerConnectionState, string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  failed: 'Connection failed',
}

export function VideoTile({ name, stream, isLocal, isHost, connectionState }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Force srcObject update when stream reference changes (covers mount + track swap)
  useEffect(() => {
    if (videoRef.current && stream && streamRef.current !== stream) {
      videoRef.current.srcObject = stream
      streamRef.current = stream
    }
  }, [stream])

  const showConnectionIssue = !isLocal && connectionState && connectionState !== 'connected' && connectionState !== 'closed'

  return (
    <div className={styles.tile}>
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
        muted={isLocal}
      />
      {!stream && (
        <div className={styles.noVideo}>
          <span className={styles.avatar}>{name.charAt(0).toUpperCase()}</span>
          {showConnectionIssue && (
            <span className={styles.connectionBadge}>
              {stateLabel[connectionState] ?? connectionState}
            </span>
          )}
        </div>
      )}
      {stream && showConnectionIssue && (
        <div className={styles.connectionOverlay}>
          <span>{stateLabel[connectionState] ?? connectionState}</span>
        </div>
      )}
      <div className={styles.tileLabel}>
        <span>{isLocal ? `${name} (you)` : name}</span>
        {isHost && <span className={styles.hostBadge}>HOST</span>}
      </div>
    </div>
  )
}
