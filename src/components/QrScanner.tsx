import { useRef, useCallback, useEffect } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import styles from './QrScanner.module.css'

interface QrScannerProps {
  onScan: (roomId: string) => void
  onClose: () => void
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleScan = useCallback(
    (decodedText: string) => {
      let url: URL
      try {
        url = new URL(decodedText)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      const match = url.pathname.match(/^\/room\/([a-zA-Z0-9-]+)$/)
      if (match) {
        onScan(match[1])
      }
    },
    [onScan],
  )

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner

    const startPromise = scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      },
      (decodedText) => {
        if (!disposed) handleScan(decodedText)
      },
      () => {},
    )

    startPromise.catch(() => {
      if (!disposed) onClose()
    })

    return () => {
      disposed = true
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {})
      } else {
        startPromise.then(() => {
          if (scannerRef.current?.isScanning) {
            scannerRef.current.stop().catch(() => {})
          }
        }).catch(() => {})
      }
    }
  }, [handleScan, onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>Scan QR Code</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.scannerContainer}>
          <div ref={containerRef} id="qr-reader" className={styles.scanner} />
        </div>
        <p className={styles.hint}>Point your camera at a PeerCall QR code</p>
      </div>
    </div>
  )
}
