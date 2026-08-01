import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useRef, useEffect } from 'react'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('peercall_name') ?? ''
    return ''
  })

  // Fallback for the rare full-page back-navigation (e.g. arriving home after
  // opening a shared room link cold): the browser restores the input's DOM
  // value without firing React events, leaving state stale. pageshow fires on
  // every page (re)show, so re-sync state from the input then.
  useEffect(() => {
    const syncFromDom = () => setName(inputRef.current?.value ?? '')
    window.addEventListener('pageshow', syncFromDom)
    return () => window.removeEventListener('pageshow', syncFromDom)
  }, [])

  const start = useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('peercall_name', trimmed)
    const roomId = crypto.randomUUID().slice(0, 12)
    navigate({ to: '/room/$roomId', params: { roomId }, search: { host: '1' } })
  }, [name, navigate])

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.badge}>
          <div className="pulse-dot" />
          <span>end-to-end encrypted · open source</span>
        </div>

        <h1 className={styles.title}>
          No servers.<br />
          No accounts.<br />
          <span className="accent">No compromise.</span>
        </h1>

        <p className={styles.sub}>
          PeerCall is a privacy-first video call that runs entirely in your browser.
          WebRTC peer-to-peer — media never touches a server.
          Local recording via MediaBunny — saved to your device, never the cloud.
        </p>

        <div className={styles.startRow}>
          <input
            ref={inputRef}
            className={styles.nameInput}
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
            maxLength={30}
            autoFocus
          />
          <button className="btn-primary" onClick={start} disabled={!name.trim()}>
            Start a call — free, forever
          </button>
        </div>

        <div className={styles.features}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>🔗</div>
            <div>
              <strong>P2P Mesh</strong>
              <p>Up to 8 participants connected directly via WebRTC. No SFU, no relay server.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>🎙</div>
            <div>
              <strong>Local Recording</strong>
              <p>Record calls as MP4/WebM directly to your device with MediaBunny. Zero upload.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>🔒</div>
            <div>
              <strong>Zero Data Collection</strong>
              <p>No accounts, no analytics, no tracking. Media never leaves your browser.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>💬</div>
            <div>
              <strong>In-Call Chat</strong>
              <p>Text messages relayed through the signaling server — ephemeral, never stored.</p>
            </div>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className="dim">PeerCall v0.1</span>
        <span className="dim">·</span>
        <a className={styles.footerLink} href="https://github.com/softwarebyze/peercall" target="_blank" rel="noopener">Source</a>
        <span className="dim">·</span>
        <span className="dim">MIT License</span>
      </footer>
    </div>
  )
}
