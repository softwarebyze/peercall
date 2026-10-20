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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<ScanStatus>({ kind: 'starting' })
  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  const applyStatus = (next: ScanStatus) => {
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
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => stream?.getTracks().forEach((track) => track.stop())

    void (async () => {
      try {
        const { scanQr } = await import('../lib/scanQr')
        if (disposed) return
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (disposed) { stop(); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        if (disposed) { stop(); return }
        applyStatus({ kind: 'live' })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        const scan = () => {
          if (disposed) return
          if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
            canvas.width = Math.round(video.videoWidth * scale)
            canvas.height = Math.round(video.videoHeight * scale)
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            const frame = context.getImageData(0, 0, canvas.width, canvas.height)
            const text = scanQr(frame.data, frame.width, frame.height)
            if (text) submitText(text, 'qr')
          }
          if (!disposed) timer = setTimeout(scan, 100)
        }
        scan()
      } catch {
        stop()
        if (!disposed) applyStatus({ kind: 'camera_failed', message: 'Camera unavailable. Paste a room link instead.' })
      }
    })()

    return () => {
      disposed = true
      clearTimeout(timer)
      stop()
      if (videoRef.current) videoRef.current.srcObject = null
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
          <div className={styles.scanner}>
            <video ref={videoRef} muted playsInline autoPlay aria-label="QR scanner camera" />
            <svg className={styles.scanFrame} viewBox="0 0 100 100" aria-hidden="true">
              <path d="M0 18V0H18 M82 0H100V18 M100 82V100H82 M18 100H0V82" />
            </svg>
          </div>
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
