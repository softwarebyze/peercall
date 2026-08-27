import { useEffect } from 'react'
import type { DeviceEntry, DeviceList, MediaKind } from '../lib/devices'
import { IconClose } from './Icons'
import styles from './Room.module.css'

export function DeviceModal(args: {
  devices: DeviceList
  cameraDeviceId: string | null
  micDeviceId: string | null
  speakerDeviceId: string | null
  showSpeaker: boolean
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

  return (
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
    </div>
  )
}

function DeviceGroup(args: {
  title: string
  devices: DeviceEntry[]
  activeId: string | null
  onSelect: (deviceId: string) => void
}) {
  return (
    <div className={styles.deviceGroup}>
      <span className={styles.deviceGroupTitle}>{args.title}</span>
      {args.devices.length === 0 && <span className="dim">None listed</span>}
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
