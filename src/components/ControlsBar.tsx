import { useState } from 'react'
import type { DeviceList, MediaKind } from '../lib/devices'
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
import { DeviceModal } from './DeviceModal'
import styles from './Room.module.css'

interface ControlsBarProps {
  cameraOn: boolean
  micOn: boolean
  cameraAvailable: boolean
  micAvailable: boolean
  recordAvailable: boolean
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

export function ControlsBar(props: ControlsBarProps) {
  const [devicesOpen, setDevicesOpen] = useState(false)
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
          className={props.cameraOn && props.cameraAvailable ? 'btn-ghost' : styles.btnOff}
          onClick={props.onToggleCamera}
          disabled={!props.cameraAvailable}
          title={
            !props.cameraAvailable
              ? 'Camera unavailable'
              : props.cameraOn
                ? 'Turn off camera'
                : 'Turn on camera'
          }
          aria-pressed={props.cameraOn && props.cameraAvailable}
        >
          {props.cameraOn && props.cameraAvailable ? <IconCamera /> : <IconCameraOff />}
        </button>

        <button
          type="button"
          className={`${styles.micBtn} ${props.micOn && props.micAvailable ? 'btn-ghost' : styles.btnOff}`}
          onClick={props.onToggleMic}
          disabled={!props.micAvailable}
          title={!props.micAvailable ? 'Mic unavailable' : props.micOn ? 'Mute' : 'Unmute'}
          aria-pressed={props.micOn && props.micAvailable}
        >
          {props.micOn && props.micAvailable ? <IconMic /> : <IconMicOff />}
          <MicMeter level={props.micLevel} muted={!props.micOn || !props.micAvailable} />
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
          disabled={!props.recording && !props.recordAvailable}
          title={
            !props.recording && !props.recordAvailable
              ? 'Recording needs a camera or screen share'
              : props.recording
                ? 'Stop recording'
                : 'Start recording'
          }
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
        >
          <IconGear />
        </button>
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
          <button
            className="btn-danger"
            onClick={props.onEndCall}
            title="End for everyone"
            aria-label="End for everyone"
            type="button"
          >
            <IconEnd />
            End for everyone
          </button>
        )}
      </div>

      {devicesOpen && (
        <DeviceModal
          devices={props.devices}
          cameraDeviceId={props.cameraDeviceId}
          micDeviceId={props.micDeviceId}
          speakerDeviceId={props.speakerDeviceId}
          showSpeaker={speakerOk}
          onSwitch={props.onSwitchDevice}
          onClose={() => setDevicesOpen(false)}
        />
      )}
    </div>
  )
}
