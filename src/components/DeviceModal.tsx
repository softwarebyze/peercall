import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceEntry, DeviceList, MediaKind } from '../lib/devices'
import { IconClose } from './Icons'
import styles from './Room.module.css'

export function DeviceModal(args: {
  devices: DeviceList
  cameraDeviceId: string | null
  micDeviceId: string | null
  speakerDeviceId: string | null
  showSpeaker: boolean
  /** Set when the call publishes no camera, so switching one cannot work. */
  cameraUnavailable?: string
  onSwitch: (args: { kind: MediaKind; deviceId: string }) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') args.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [args.onClose])

  // Portal to <body>: `.controls` sets z-index + position, which creates a
  // stacking context that traps the overlay below `.topBar` (z-index 40).
  return createPortal(
    <div className={styles.modalOverlay} onClick={args.onClose} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-labelledby="device-title"
        data-testid="device-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3 id="device-title" className={styles.modalTitle}>
            Devices
          </h3>
          <button type="button" className={styles.iconBtn} onClick={args.onClose} aria-label="Close devices">
            <IconClose size={16} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <DeviceGroup
            title="Camera"
            devices={args.devices.cameras}
            activeId={args.cameraDeviceId}
            disabledReason={args.cameraUnavailable}
            onSelect={(deviceId) => args.onSwitch({ kind: 'camera', deviceId })}
          />
          <DeviceGroup
            title="Mic"
            devices={args.devices.mics}
            activeId={args.micDeviceId}
            onSelect={(deviceId) => args.onSwitch({ kind: 'mic', deviceId })}
          />
          {args.showSpeaker && (
            <DeviceGroup
              title="Speaker"
              devices={args.devices.speakers}
              activeId={args.speakerDeviceId}
              onSelect={(deviceId) => args.onSwitch({ kind: 'speaker', deviceId })}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function DeviceGroup(args: {
  title: string
  devices: DeviceEntry[]
  activeId: string | null
  disabledReason?: string
  onSelect: (deviceId: string) => void
}) {
  return (
    <div className={styles.deviceGroup} data-testid={`devices-${args.title.toLowerCase()}`}>
      <span className={styles.deviceGroupTitle}>{args.title}</span>
      {args.devices.length === 0 && <span className="dim">None listed</span>}
      {args.devices.length > 0 && args.disabledReason && (
        <span className={styles.deviceUnavailable}>{args.disabledReason}</span>
      )}
      {args.devices.map((d) => {
        const selected = d.deviceId === args.activeId
        return (
          <button
            key={d.deviceId}
            type="button"
            className={selected ? styles.deviceSelected : styles.deviceChoice}
            aria-pressed={selected}
            disabled={args.disabledReason !== undefined}
            onClick={() => args.onSelect(d.deviceId)}
          >
            <span className={`pulse-dot ${selected ? '' : styles.deviceDotOff}`} aria-hidden />
            {d.label}
          </button>
        )
      })}
    </div>
  )
}
