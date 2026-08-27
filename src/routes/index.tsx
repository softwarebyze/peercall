import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useRef, useEffect } from 'react'
import { QrScanner } from '../components/QrScanner'
import { IconChat, IconLock, IconMesh, IconQr, IconRecord } from '../components/Icons'
import { parseRoomJoin } from '../lib/roomUrl'
import { generateRoomId } from '../lib/roomId'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  component: Landing,
})

function storeName(name: string) {
  const trimmed = name.trim()
  if (trimmed) localStorage.setItem('peercall_name', trimmed)
  else localStorage.removeItem('peercall_name')
  return trimmed
}

function Landing() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('peercall_name') ?? ''
    return ''
  })
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    const syncFromDom = () => {
      if (inputRef.current) setName(inputRef.current.value)
    }
    window.addEventListener('pageshow', syncFromDom)
    return () => window.removeEventListener('pageshow', syncFromDom)
  }, [])

  const start = useCallback(() => {
    const trimmed = storeName(name)
    if (!trimmed) return
    const roomId = generateRoomId()
    void navigate({ to: '/room/$roomId', params: { roomId }, search: { host: 1 } })
  }, [name, navigate])

  const goToRoom = useCallback(
    (roomId: string) => {
      storeName(name)
      setShowScanner(false)
      void navigate({ to: '/room/$roomId', params: { roomId } })
    },
    [name, navigate],
  )

  const joinExisting = useCallback(() => {
    const parsed = parseRoomJoin({
      text: joinInput,
      origin: window.location.origin,
      mode: 'paste',
    })
    switch (parsed.kind) {
      case 'room':
        setJoinError(null)
        goToRoom(parsed.roomId)
        return
      case 'invalid':
        setJoinError('Need a /room/ link or a room id.')
        return
      default: {
        const _exhaustive: never = parsed
        return _exhaustive
      }
    }
  }, [joinInput, goToRoom])

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.badge}>
          <div className="pulse-dot" />
          <span>peer-to-peer · open source</span>
        </div>

        <h1 className={styles.title}>
          No servers.<br />
          No accounts.<br />
          <span className="accent">No compromise.</span>
        </h1>

        <p className={styles.sub}>
          Browser-to-browser video. Media stays on the WebRTC peer connection
          (DTLS-SRTP). Chat rides the signaling server, then the room is gone.
          Recordings save to your disk.
        </p>

        <div className={styles.startBlock}>
          <label className={styles.fieldLabel} htmlFor="display-name">
            Name shown to others
          </label>
          <div className={styles.startRow}>
            <input
              id="display-name"
              ref={inputRef}
              className={styles.nameInput}
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              maxLength={30}
              autoFocus
              autoComplete="nickname"
            />
            <button className="btn-primary" onClick={start} disabled={!name.trim()} type="button">
              Start call
            </button>
            <button
              className={styles.scanBtn}
              onClick={() => setShowScanner(true)}
              title="Scan QR code to join"
              type="button"
              aria-label="Scan QR code to join"
            >
              <IconQr />
            </button>
          </div>
        </div>

        <form
          className={styles.joinBlock}
          onSubmit={(e) => {
            e.preventDefault()
            joinExisting()
          }}
        >
          <label className={styles.fieldLabel} htmlFor="join-link">
            Have an invite?
          </label>
          <div className={styles.startRow}>
            <input
              id="join-link"
              className={styles.nameInput}
              type="text"
              placeholder="Paste room link or id"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              data-testid="join-link-input"
            />
            <button className="btn-ghost" type="submit" disabled={!joinInput.trim()}>
              Join
            </button>
          </div>
          {joinError && <p className={styles.joinError}>{joinError}</p>}
        </form>

        <div className={styles.productFrame} aria-hidden>
          <div className={styles.productBar}>
            <div className="pulse-dot" />
            <span className="accent">PeerCall</span>
            <span>·</span>
            <span>brave-otter-pine</span>
            <span style={{ marginLeft: 'auto' }}>Copy invite</span>
          </div>
          <div className={styles.productTiles}>
            <div className={styles.productYou}>
              <span className={styles.productAvatar}>Y</span>
              <span>You</span>
            </div>
            <div className={styles.productWait}>Waiting for others</div>
          </div>
        </div>

        {showScanner && (
          <QrScanner onScan={goToRoom} onClose={() => setShowScanner(false)} />
        )}

        <div className={styles.features}>
          <div className={styles.feature}>
            <div className={styles.featureMark}>
              <IconMesh />
            </div>
            <div>
              <strong>P2P mesh</strong>
              <p>Up to 8 browsers, connected directly. No SFU.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureMark}>
              <IconRecord />
            </div>
            <div>
              <strong>Local recording</strong>
              <p>MP4 via MediaBunny, written to your machine. Nothing uploads.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureMark}>
              <IconLock />
            </div>
            <div>
              <strong>No accounts</strong>
              <p>A name in localStorage. No analytics. Media never hits our disk.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureMark}>
              <IconChat />
            </div>
            <div>
              <strong>In-call chat</strong>
              <p>Signaling relays text. The room and the log die together.</p>
            </div>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className="dim">PeerCall v0.1</span>
        <span className="dim">·</span>
        <a className={styles.footerLink} href="https://github.com/softwarebyze/peercall" target="_blank" rel="noopener">
          Source
        </a>
        <span className="dim">·</span>
        <span className="dim">MIT License</span>
      </footer>
    </div>
  )
}
