import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLocalMedia, type MediaHandoff } from '../hooks/useLocalMedia'
import { useMediaDevices } from '../hooks/useMediaDevices'
import { useMicLevel } from '../hooks/useMicLevel'
import { VideoTile } from './VideoTile'
import { DeviceModal } from './DeviceModal'
import { IconCamera, IconCameraOff, IconDevices, IconMic, IconMicOff, IconWarn } from './Icons'
import { activeDeviceId, labelFor, supportsSinkId, type MediaKind } from '../lib/devices'
import styles from './Room.module.css'

export function Lobby(args: {
  roomId: string
  initialName: string
  onJoin: (args: { name: string; media: MediaHandoff }) => void
}) {
  const [name, setName] = useState(args.initialName)
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [listen, setListen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [speakerId, setSpeakerId] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [micId, setMicId] = useState<string | null>(null)
  const media = useLocalMedia()
  const stream = media.state.kind === 'live' ? media.state.stream : null
  const devices = useMediaDevices({ stream })
  const micLevel = useMicLevel({ stream, active: micOn && !listen })
  const speakerOk = supportsSinkId()

  // Refs mirror the latest values so an async device switch resolves against
  // the stream and toggles that are current when it lands, not the ones
  // captured at click time.
  const streamRef = useRef<MediaStream | null>(null)
  streamRef.current = stream
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const micOnRef = useRef(micOn)
  micOnRef.current = micOn
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    []
  )

  useEffect(() => {
    if (media.state.kind === 'live') {
      media.state.stream.getVideoTracks().forEach((t) => {
        t.enabled = cameraOn
      })
      media.state.stream.getAudioTracks().forEach((t) => {
        t.enabled = micOn
      })
    }
  }, [media.state, cameraOn, micOn])

  // The active device lives on the live track, and `switchDevice` mutates the
  // stream in place (so its identity never changes). Track the ids in state and
  // refresh them whenever the stream itself is replaced.
  useEffect(() => {
    setCameraId(activeDeviceId({ stream, kind: 'video' }))
    setMicId(activeDeviceId({ stream, kind: 'audio' }))
  }, [stream])

  const hasVideo = media.state.kind === 'live' && media.state.hasVideo
  const hasAudio = media.state.kind === 'live' && media.state.hasAudio

  const switchDevice = (sel: { kind: MediaKind; deviceId: string }) => {
    if (sel.kind === 'speaker') {
      setSpeakerId(sel.deviceId)
      return
    }
    const trackKind = sel.kind === 'camera' ? 'video' : 'audio'
    void navigator.mediaDevices
      .getUserMedia({
        [trackKind]: { deviceId: { exact: sel.deviceId } },
      })
      .then((next) => {
        const newTrack = next.getTracks()[0]
        // Only mutate the stream we still own. If the lobby unmounted, or
        // `retry`/`audioOnly` swapped in a new (or stopped) stream while
        // getUserMedia was pending, adding here would leak the fresh track and
        // leave the active stream unchanged.
        const target = streamRef.current
        const targetLive = target?.getTracks().some((t) => t.readyState === 'live') ?? false
        if (!aliveRef.current || !newTrack || !target || !targetLive) {
          next.getTracks().forEach((t) => t.stop())
          return
        }
        const old = target.getTracks().find((t) => t.kind === trackKind)
        old?.stop()
        if (old) target.removeTrack(old)
        target.addTrack(newTrack)
        newTrack.enabled = trackKind === 'video' ? cameraOnRef.current : micOnRef.current
        const activeId = activeDeviceId({ stream: target, kind: trackKind })
        if (trackKind === 'video') setCameraId(activeId)
        else setMicId(activeId)
      })
      .catch(() => {})
  }

  const join = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const handoff = listen
      ? media.handoff({ cameraOn: false, micOn: false, listen: true })
      : media.handoff({ cameraOn, micOn, listen: false })
    args.onJoin({ name: trimmed, media: handoff })
  }

  return (
    <div className={styles.lobby} data-testid="lobby">
      <div className={styles.lobbyMain}>
        <div className={styles.lobbyPreview}>
          <VideoTile
            name={name.trim() || 'You'}
            stream={listen ? null : stream}
            isLocal
            isHost={false}
            videoOff={listen || !cameraOn || !hasVideo}
            micOff={listen || !micOn || !hasAudio}
            sinkId={speakerId}
          />
        </div>
        <div className={styles.lobbyForm}>
          <div className={styles.badgeRow}>
            <div className="pulse-dot" />
            <span className="accent">PeerCall</span>
            <span className="dim">·</span>
            <span className={styles.roomCode}>{args.roomId}</span>
          </div>
          <div className={styles.lobbyIntro}>
            <h1 className={styles.lobbyTitle}>Ready?</h1>
            <p className={`${styles.lobbyDescription} dim`}>Check your camera and mic before anyone else hears you.</p>
          </div>

          <label className={styles.fieldLabel} htmlFor="lobby-name">
            Name shown to others
          </label>
          <input
            id="lobby-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="Your name"
            autoComplete="nickname"
          />

          {media.state.kind === 'blocked' && !listen && (
            <div className={styles.mediaError}>
              <IconWarn size={16} />
              <span>{media.state.message}</span>
            </div>
          )}
          {listen && (
            <div className={styles.mediaInfo}>
              <span>Listen-only. You'll join with your camera and mic off.</span>
            </div>
          )}
          {media.state.kind === 'pending' && <p className="dim">Starting camera and microphone…</p>}
          {media.state.kind === 'live' && !media.state.hasVideo && (
            <p className="dim">Your microphone is ready. Camera unavailable.{' '}
              <button type="button" className="btn-ghost" onClick={media.retry}>Retry camera</button>
            </p>
          )}

          <div className={styles.lobbyToggles}>
            <button
              type="button"
              className={cameraOn && hasVideo && !listen ? 'btn-ghost' : styles.btnOff}
              onClick={() => setCameraOn((v) => !v)}
              disabled={!hasVideo || listen}
              title={!hasVideo || listen ? 'Camera unavailable' : cameraOn ? 'Turn off camera' : 'Turn on camera'}
            >
              {cameraOn && hasVideo && !listen ? <IconCamera /> : <IconCameraOff />}
            </button>
            <button
              type="button"
              className={micOn && hasAudio && !listen ? 'btn-ghost' : styles.btnOff}
              onClick={() => setMicOn((v) => !v)}
              disabled={!hasAudio || listen}
              title={!hasAudio || listen ? 'Mic unavailable' : micOn ? 'Mute' : 'Unmute'}
            >
              {micOn && hasAudio && !listen ? <IconMic /> : <IconMicOff />}
              <span className={styles.micMeter} aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className={`${styles.micBar} ${!listen && micOn && i < Math.round(micLevel * 5) ? styles.micBarOn : ''}`}
                  />
                ))}
              </span>
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setDevicesOpen(true)}
              title="Device settings"
            >
              <IconDevices />
              <span>Devices</span>
            </button>
          </div>
          <p className={styles.deviceHint}>
            {labelFor({ devices: devices.cameras, deviceId: cameraId, fallback: 'Camera' })}
            {' · '}
            {labelFor({ devices: devices.mics, deviceId: micId, fallback: 'Mic' })}
          </p>

          <div className={styles.lobbyActions}>
            {media.state.kind === 'blocked' && (
              <>
                <button className="btn-ghost" type="button" onClick={media.retry}>
                  Retry
                </button>
                <button className="btn-ghost" type="button" onClick={media.audioOnly}>
                  Audio only
                </button>
                <button
                  className={listen ? styles.btnActive : 'btn-ghost'}
                  type="button"
                  onClick={() => setListen(true)}
                  aria-pressed={listen}
                >
                  Listen only
                </button>
              </>
            )}
            <button
              className="btn-primary"
              type="button"
              onClick={join}
              disabled={
                !name.trim() ||
                media.state.kind === 'pending' ||
                (media.state.kind === 'blocked' && !listen)
              }
            >
              Join call
            </button>
            <Link to="/" className="btn-ghost">
              Back
            </Link>
          </div>
        </div>
      </div>

      {devicesOpen && (
        <DeviceModal
          devices={devices}
          cameraDeviceId={cameraId}
          micDeviceId={micId}
          speakerDeviceId={speakerId}
          showSpeaker={speakerOk}
          onSwitch={switchDevice}
          onClose={() => setDevicesOpen(false)}
        />
      )}
    </div>
  )
}
