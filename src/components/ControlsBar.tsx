import { useState } from 'react'
import styles from './Room.module.css'

interface ControlsBarProps {
  cameraOn: boolean
  micOn: boolean
  screenSharing: boolean
  screenShareSupported: boolean
  recording: boolean
  chatOpen: boolean
  isHost: boolean
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  onToggleCamera: () => void
  onToggleMic: () => void
  onShareScreen: () => void
  onStopScreen: () => void
  onRecordToggle: () => void
  onToggleChat: () => void
  onSwitchDevice: (kind: 'videoinput' | 'audioinput', deviceId: string) => void
  onLeave: () => void
  onEndCall: () => void
}

export function ControlsBar(props: ControlsBarProps) {
  const [devicesOpen, setDevicesOpen] = useState(false)

  return (
    <div className={styles.controls}>
      <div className={styles.controlsLeft}>
        <button
          className={props.cameraOn ? 'btn-ghost' : styles.btnOff}
          onClick={props.onToggleCamera}
          title={props.cameraOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {props.cameraOn ? '📷' : '📷✕'}
        </button>

        <button
          className={props.micOn ? 'btn-ghost' : styles.btnOff}
          onClick={props.onToggleMic}
          title={props.micOn ? 'Mute' : 'Unmute'}
        >
          {props.micOn ? '🎙' : '🎙✕'}
        </button>

        {props.screenShareSupported && (
          <button
            className={props.screenSharing ? 'btn-primary' : 'btn-ghost'}
            onClick={props.screenSharing ? props.onStopScreen : props.onShareScreen}
            title={props.screenSharing ? 'Stop sharing' : 'Share screen'}
          >
            {props.screenSharing ? '⬛ Stop Share' : '🖥 Share'}
          </button>
        )}

        <button
          className={props.recording ? styles.btnRecording : 'btn-ghost'}
          onClick={props.onRecordToggle}
          title={props.recording ? 'Stop recording' : 'Start recording'}
        >
          {props.recording ? '⏹ Stop' : '⏺ Record'}
        </button>

        <button
          className={devicesOpen ? styles.btnActive : 'btn-ghost'}
          onClick={() => setDevicesOpen((v) => !v)}
          title="Device settings"
        >
          ⚙
        </button>

        {devicesOpen && (
          <div className={styles.devicePanel}>
            {props.devices.video.length > 0 && (
              <div className={styles.deviceGroup}>
                <span className="dim" style={{ fontSize: '0.7rem' }}>CAMERA</span>
                {props.devices.video.map((d) => (
                  <button
                    key={d.deviceId}
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                    onClick={() => props.onSwitchDevice('videoinput', d.deviceId)}
                  >
                    {d.label || `Camera ${d.deviceId.slice(0, 4)}`}
                  </button>
                ))}
              </div>
            )}
            {props.devices.audio.length > 0 && (
              <div className={styles.deviceGroup}>
                <span className="dim" style={{ fontSize: '0.7rem' }}>MIC</span>
                {props.devices.audio.map((d) => (
                  <button
                    key={d.deviceId}
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                    onClick={() => props.onSwitchDevice('audioinput', d.deviceId)}
                  >
                    {d.label || `Mic ${d.deviceId.slice(0, 4)}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.controlsRight}>
        <button
          className={props.chatOpen ? styles.btnActive : 'btn-ghost'}
          onClick={props.onToggleChat}
          title="Chat"
        >
          💬
        </button>

        {props.isHost ? (
          <button className="btn-danger" onClick={props.onEndCall} title="End call for all">
            End Call
          </button>
        ) : (
          <button className="btn-danger" onClick={props.onLeave} title="Leave call">
            Leave
          </button>
        )}
      </div>
    </div>
  )
}
