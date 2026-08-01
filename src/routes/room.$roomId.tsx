import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
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

  const stored = typeof window !== 'undefined' ? localStorage.getItem('peercall_name') : null
  const [displayName, setDisplayName] = useState(stored ?? '')
  const [joined, setJoined] = useState(!!stored)

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
