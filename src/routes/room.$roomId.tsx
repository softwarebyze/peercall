import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { Room } from '../components/Room'
import styles from './index.module.css'

type RoomSearch = { host?: '1' }

function parseRoomSearch(search: Record<string, unknown>): RoomSearch {
  // TanStack may parse ?host=1 as the number 1.
  if (String(search.host ?? '') === '1') return { host: '1' }
  return {}
}

export const Route = createFileRoute('/room/$roomId')({
  validateSearch: parseRoomSearch,
  head: () => ({
    meta: [{ title: 'PeerCall — Join a call' }],
  }),
  component: RoomPage,
})

function RoomPage() {
  const { roomId } = Route.useParams()
  const search = Route.useSearch()
  const isHost = search.host === '1'

  const [displayName, setDisplayName] = useState('')
  const [joined, setJoined] = useState(false)
  const [ready, setReady] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem('peercall_name') ?? ''
    setDisplayName(stored)
    // Hosts arrive from the landing page where they just typed a name.
    // Invitees always confirm before joining.
    if (isHost && stored) setJoined(true)
    setReady(true)
  }, [isHost])

  useEffect(() => {
    const syncFromDom = () => {
      if (inputRef.current) setDisplayName(inputRef.current.value)
    }
    window.addEventListener('pageshow', syncFromDom)
    return () => window.removeEventListener('pageshow', syncFromDom)
  }, [])

  if (!ready) return null

  if (!joined) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.badge}>
            <div className="pulse-dot" />
            <span>Join room</span>
          </div>
          <h1 className={styles.title} style={{ fontSize: '2rem' }}>
            Enter your name
          </h1>
          <p className={styles.sub}>
            Room <span className="accent">{roomId}</span>
          </p>
          <div className={styles.startBlock}>
            <input
              ref={inputRef}
              className={styles.nameInput}
              type="text"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && displayName.trim()) {
                  localStorage.setItem('peercall_name', displayName.trim())
                  setJoined(true)
                }
              }}
              maxLength={30}
              autoFocus
            />
            <button
              className="btn-primary"
              disabled={!displayName.trim()}
              type="button"
              onClick={() => {
                localStorage.setItem('peercall_name', displayName.trim())
                setJoined(true)
              }}
            >
              Join
            </button>
            <Link to="/" className="btn-ghost" style={{ alignSelf: 'center' }}>
              Back
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <Room roomId={roomId} displayName={displayName} isHost={isHost} />
}
