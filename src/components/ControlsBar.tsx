import { useEffect, useId, useState } from 'react'
import type { DeviceEntry, DeviceList, MediaKind } from '../lib/devices'
import { labelFor, supportsSinkId } from '../lib/devices'
import {
  IconCamera,
  IconCameraOff,
  IconChat,
  IconEnd,
  IconGear,
  IconLeave,
  IconMic,
  IconMicOff,
  IconRecord,
  IconScreen,
  IconShot,
  IconStop,
} from './Icons'
import styles from './Room.module.css'

interface ControlsBarProps {
  cameraOn: boolean
  micOn: boolean
  screenSharing: boolean
  recording: boolean
  chatOpen: boolean
  isHost: boolean
  devices: DeviceList
  cameraDeviceId: string | null
  micDeviceId: string | null
  speakerDeviceId: string | null
  micLevel: number
  onToggleCamera: () => void
  onToggleMic: () => void
  onShareScreen: () => void
  onStopScreen: () => void
  onRecordToggle: () => void
  onScreenshot: () => void
  onToggleChat: () => void
  onSwitchDevice: (args: { kind: MediaKind; deviceId: string }) => void
  onLeave: () => void
  onEndCall: () => void
}

function MicMeter({ level, muted }: { level: number; muted: boolean }) {
  const steps = 5
  const filled = muted ? 0 : Math.round(level * steps)
  return (
    <span className={styles.micMeter} data-testid="mic-meter" aria-hidden>
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={`${styles.micBar} ${i < filled ? styles.micBarOn : ''}`}
        />
      ))}
    </span>
  )
}

function DeviceChoices(args: {
  title: string
  devices: DeviceEntry[]
  activeId: string | null
  onSelect: (deviceId: string) => void
}) {
  if (args.devices.length === 0) return null
  return (
    <div className={styles.deviceGroup}>
      <span className={styles.deviceGroupTitle}>{args.title}</span>
      {args.devices.map((d) => {
        const selected = d.deviceId === args.activeId
        return (
          <button
            key={d.deviceId}
            type="button"
            className={selected ? styles.deviceSelected : styles.deviceChoice}
            aria-pressed={selected}
            onClick={() => args.onSelect(d.deviceId)}
          >
            {selected && <span className="pulse-dot" />}
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

export function ControlsBar(props: ControlsBarProps) {
  const [devicesOpen, setDevicesOpen] = useState(false)
  const panelId = useId()
  const speakerOk = supportsSinkId()
  const cameraName = labelFor({
    devices: props.devices.cameras,
    deviceId: props.cameraDeviceId,
    fallback: props.cameraOn ? 'Camera' : 'Camera off',
  })
  const micName = labelFor({
    devices: props.devices.mics,
    deviceId: props.micDeviceId,
    fallback: props.micOn ? 'Mic' : 'Muted',
  })
  const speakerName = labelFor({
    devices: props.devices.speakers,
    deviceId: props.speakerDeviceId,
    fallback: speakerOk ? 'Speaker' : 'Default speaker',
  })

  useEffect(() => {
    if (!devicesOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDevicesOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [devicesOpen])

  return (
    <div className={styles.controls}>
      <div className={styles.deviceReadout} data-testid="device-readout" title={`${cameraName} · ${micName} · ${speakerName}`}>
        <span>{cameraName}</span>
        <span className={styles.readoutDot} />
        <span>{micName}</span>
        <span className={styles.readoutDot} />
        <span>{speakerName}</span>
      </div>

      <div className={styles.controlsLeft}>
        <button
          type="button"
          className={props.cameraOn ? 'btn-ghost' : styles.btnOff}
          onClick={props.onToggleCamera}
          title={props.cameraOn ? 'Turn off camera' : 'Turn on camera'}
          aria-pressed={props.cameraOn}
        >
          {props.cameraOn ? <IconCamera /> : <IconCameraOff />}
        </button>

        <button
          type="button"
          className={`${styles.micBtn} ${props.micOn ? 'btn-ghost' : styles.btnOff}`}
          onClick={props.onToggleMic}
          title={props.micOn ? 'Mute' : 'Unmute'}
          aria-pressed={props.micOn}
        >
          {props.micOn ? <IconMic /> : <IconMicOff />}
          <MicMeter level={props.micLevel} muted={!props.micOn} />
        </button>

        <button
          type="button"
          className={props.screenSharing ? styles.btnActive : 'btn-ghost'}
          onClick={props.screenSharing ? props.onStopScreen : props.onShareScreen}
          title={props.screenSharing ? 'Stop sharing' : 'Share screen'}
          aria-pressed={props.screenSharing}
        >
          {props.screenSharing ? <IconStop /> : <IconScreen />}
          <span className={styles.ctrlText}>{props.screenSharing ? 'Stop' : 'Share'}</span>
        </button>

        <button
          type="button"
          className={props.recording ? styles.btnRecording : 'btn-ghost'}
          onClick={props.onRecordToggle}
          title={props.recording ? 'Stop recording' : 'Start recording'}
          aria-pressed={props.recording}
        >
          {props.recording ? <IconStop /> : <IconRecord />}
          <span className={styles.ctrlText}>{props.recording ? 'Stop' : 'Record'}</span>
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={props.onScreenshot}
          title="Take screenshot"
        >
          <IconShot />
          <span className={styles.ctrlText}>Shot</span>
        </button>

        <button
          type="button"
          className={devicesOpen ? styles.btnActive : 'btn-ghost'}
          onClick={() => setDevicesOpen((v) => !v)}
          title="Device settings"
          aria-expanded={devicesOpen}
          aria-controls={panelId}
        >
          <IconGear />
        </button>

        {devicesOpen && (
          <div id={panelId} className={styles.devicePanel} data-testid="device-panel">
            <DeviceChoices
              title="Camera"
              devices={props.devices.cameras}
              activeId={props.cameraDeviceId}
              onSelect={(deviceId) => props.onSwitchDevice({ kind: 'camera', deviceId })}
            />
            <DeviceChoices
              title="Mic"
              devices={props.devices.mics}
              activeId={props.micDeviceId}
              onSelect={(deviceId) => props.onSwitchDevice({ kind: 'mic', deviceId })}
            />
            {speakerOk && (
              <DeviceChoices
                title="Speaker"
                devices={props.devices.speakers}
                activeId={props.speakerDeviceId}
                onSelect={(deviceId) => props.onSwitchDevice({ kind: 'speaker', deviceId })}
              />
            )}
          </div>
        )}
      </div>

      <div className={styles.controlsRight}>
        <button
          type="button"
          className={props.chatOpen ? styles.btnActive : 'btn-ghost'}
          onClick={props.onToggleChat}
          title="Chat"
          aria-pressed={props.chatOpen}
        >
          <IconChat />
        </button>

        <button className="btn-ghost" onClick={props.onLeave} title="Leave call" type="button">
          <IconLeave />
          Leave
        </button>
        {props.isHost && (
          <button className="btn-danger" onClick={props.onEndCall} title="End call for all" type="button">
            <IconEnd />
            End for everyone
          </button>
        )}
      </div>
    </div>
  )
}
