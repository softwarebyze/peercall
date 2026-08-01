import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { Room } from '../components/Room'

export const Route = createFileRoute('/room/$roomId')({
  head: () => ({
    meta: [{ title: 'PeerCall — Join a call' }],
  }),
  component: RoomPage,
})

function RoomPage() {
  const { roomId } = Route.useParams()
  const search = Route.useSearch() as Record<string, string>
  const isHost = search.host === '1'

  const [displayName, setDisplayName] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('peercall_name') ?? ''
    return ''
  })
  const [joined, setJoined] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-join returning users. The lazy initializer above already picks up a
  // stored name on client-side mounts, but during SSR hydration React keeps
  // the server-rendered state, so re-check after mount for cold loads.
  useEffect(() => {
    const stored = localStorage.getItem('peercall_name')
    if (stored) {
      setDisplayName(stored)
      setJoined(true)
    }
  }, [])

  // Same fallback as the landing page: on a full-page back-navigation the
  // browser restores the input's DOM value without firing React events, so
  // re-sync state from the input on pageshow.
  useEffect(() => {
    const syncFromDom = () => setDisplayName(inputRef.current?.value ?? '')
    window.addEventListener('pageshow', syncFromDom)
    return () => window.removeEventListener('pageshow', syncFromDom)
  }, [])

  if (!joined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <h2 style={{ margin: 0, letterSpacing: '-0.03em' }}>Join call</h2>
        <p className="dim">Enter your name to join room <span className="accent">{roomId}</span></p>
        <input
          ref={inputRef}
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
          style={{ width: 260 }}
        />
        <button
          className="btn-primary"
          disabled={!displayName.trim()}
          onClick={() => {
            localStorage.setItem('peercall_name', displayName.trim())
            setJoined(true)
          }}
        >
          Join
        </button>
      </div>
    )
  }

  return <Room roomId={roomId} displayName={displayName} isHost={isHost} />
}
