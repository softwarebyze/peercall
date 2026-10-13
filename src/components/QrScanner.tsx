import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './QrScanner.module.css'
import { parseRoomJoin } from '../lib/roomUrl'
import { IconClose } from './Icons'

type ScanStatus =
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'camera_failed'; message: string }

interface QrScannerProps {
  onScan: (roomId: string) => void
  onClose: () => void
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const readerId = 'qr-reader'
  const statusRef = useRef<ScanStatus>({ kind: 'starting' })
  const [status, setStatus] = useState<ScanStatus>({ kind: 'starting' })
  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  const applyStatus = (next: ScanStatus) => {
    statusRef.current = next
    setStatus(next)
  }

  const submitText = useCallback(
    (text: string, mode: 'qr' | 'paste') => {
      const parsed = parseRoomJoin({ text, origin: window.location.origin, mode })
      switch (parsed.kind) {
        case 'room':
          setPasteError(null)
          onScan(parsed.roomId)
          return
        case 'invalid': {
          if (mode === 'paste') setPasteError(reasonCopy(parsed.reason))
          return
        }
        default: {
          const _exhaustive: never = parsed
          return _exhaustive
        }
      }
    },
    [onScan],
  )

  useEffect(() => {
    let disposed = false
    let scanner: { stop: () => Promise<void>; isScanning: boolean } | null = null
    let startPromise: Promise<void> = Promise.resolve()

    void (async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (disposed) return
      const instance = new Html5Qrcode(readerId)
      scanner = instance
      startPromise = instance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
        (decodedText) => {
          if (!disposed) submitText(decodedText, 'qr')
        },
        () => {},
      ).then(() => undefined)
      try {
        await startPromise
        if (!disposed) applyStatus({ kind: 'live' })
      } catch {
        if (!disposed) {
          applyStatus({
            kind: 'camera_failed',
            message: 'Camera unavailable. Paste a room link instead.',
          })
        }
      }
    })()

    return () => {
      disposed = true
      const stop = () => {
        if (scanner?.isScanning) void scanner.stop().catch(() => {})
      }
      if (scanner?.isScanning) stop()
      else void startPromise.then(stop).catch(() => {})
    }
  }, [submitText])

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="qr-title"
        data-testid="qr-scanner"
      >
        <div className={styles.header}>
          <h3 id="qr-title" className={styles.title}>
            Scan to join
          </h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close scanner" type="button">
            <IconClose size={16} />
          </button>
        </div>
        <div className={styles.scannerContainer}>
          <div id={readerId} className={styles.scanner} />
        </div>
        <p className={styles.hint}>
          {status.kind === 'camera_failed' ? status.message : 'Point the camera at a PeerCall room QR, or paste the link.'}
        </p>
        <form
          className={styles.pasteRow}
          onSubmit={(e) => {
            e.preventDefault()
            submitText(paste, 'paste')
          }}
        >
          <input
            type="text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste room link or id"
            aria-label="Paste room link"
            data-testid="qr-paste"
          />
          <button className="btn-primary" type="submit" disabled={!paste.trim()}>
            Join
          </button>
        </form>
        {pasteError && <p className={styles.error}>{pasteError}</p>}
      </div>
    </div>
  )
}

function reasonCopy(reason: 'empty' | 'not_url' | 'wrong_origin' | 'not_room_path' | 'bad_room_id'): string {
  switch (reason) {
    case 'empty':
      return 'Paste a room link or id.'
    case 'not_url':
      return 'Not a valid room link or id.'
    case 'wrong_origin':
      return 'That link is for a different site.'
    case 'not_room_path':
      return 'Need a /room/… link or a room id.'
    case 'bad_room_id':
      return 'Room id looks wrong.'
    default: {
      const _exhaustive: never = reason
      return _exhaustive
    }
  }
}
