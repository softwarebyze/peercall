import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Room } from '../components/Room'

export const Route = createFileRoute('/room/$roomId')({
  head: () => ({
    meta: [{ title: 'PeerCall — Join a call' }],
  }),
  component: RoomPage,
})

function RoomPage() {
  const { roomId } = Route.useParams()
  const search = Route.useSearch() as Record<string, unknown>
  // TanStack Router parses ?host=1 as the number 1, so compare loosely.
  const isHost = String(search.host ?? '') === '1'

  const [displayName, setDisplayName] = useState('')
  const [joined, setJoined] = useState(false)
  const [ready, setReady] = useState(false)

  // Read localStorage after mount — reading it during render makes the server
  // and client HTML disagree, and React leaves the mismatched attributes
  // (like a disabled Join button) unpatched.
  useEffect(() => {
    const stored = localStorage.getItem('peercall_name') ?? ''
    setDisplayName(stored)
    // Hosts arrive straight from the landing page where they just typed their
    // name — skip the gate. Invitees always get to confirm/edit their name.
    if (isHost && stored) setJoined(true)
    setReady(true)
  }, [isHost])

  if (!ready) return null

  if (!joined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <h2 style={{ margin: 0, letterSpacing: '-0.03em' }}>Join call</h2>
        <p className="dim">Enter your name to join room <span className="accent">{roomId}</span></p>
        <input
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
