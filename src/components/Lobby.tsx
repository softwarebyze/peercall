import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLocalMedia, type MediaHandoff } from '../hooks/useLocalMedia'
import { useMediaDevices } from '../hooks/useMediaDevices'
import { useMicLevel } from '../hooks/useMicLevel'
import { VideoTile } from './VideoTile'
import { DeviceModal } from './DeviceModal'
import { IconCamera, IconCameraOff, IconGear, IconMic, IconMicOff, IconWarn } from './Icons'
import { labelFor, supportsSinkId, type MediaKind } from '../lib/devices'
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
  const media = useLocalMedia()
  const stream = media.state.kind === 'live' ? media.state.stream : null
  const devices = useMediaDevices({ stream })
  const micLevel = useMicLevel({ stream, active: micOn && !listen })
  const speakerOk = supportsSinkId()

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

  const hasVideo = media.state.kind === 'live' && media.state.hasVideo
  const hasAudio = media.state.kind === 'live' && media.state.hasAudio
  const cameraId = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null
  const micId = stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null

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
        if (!newTrack || media.state.kind !== 'live') {
          next.getTracks().forEach((t) => t.stop())
          return
        }
        const old = media.state.stream.getTracks().find((t) => t.kind === trackKind)
        old?.stop()
        if (old) media.state.stream.removeTrack(old)
        media.state.stream.addTrack(newTrack)
        newTrack.enabled = trackKind === 'video' ? cameraOn : micOn
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
          <h1 className={styles.lobbyTitle}>Ready?</h1>
          <p className="dim">Check your camera and mic before anyone else hears you.</p>

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

          {media.state.kind === 'blocked' && (
            <div className={styles.mediaError}>
              <IconWarn size={16} />
              <span>{media.state.message}</span>
            </div>
          )}
          {media.state.kind === 'pending' && <p className="dim">Starting camera and microphone…</p>}
          {media.state.kind === 'live' && !media.state.hasVideo && (
            <p className="dim">Audio only. No camera on this device.</p>
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
              <IconGear />
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
                  className="btn-ghost"
                  type="button"
                  onClick={() => setListen(true)}
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
