import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Room } from '../components/Room'
import { Lobby } from '../components/Lobby'
import type { MediaHandoff } from '../hooks/useLocalMedia'

type RoomSearch = { host?: 1 }

function parseRoomSearch(search: Record<string, unknown>): RoomSearch {
  // TanStack may parse ?host=1 as the number 1; JSON search may pass the string "1".
  if (String(search.host ?? '') === '1') return { host: 1 }
  return {}
}

export const Route = createFileRoute('/room/$roomId')({
  validateSearch: parseRoomSearch,
  head: () => ({
    meta: [
      { title: 'Join the call — PeerCall' },
      { name: 'description', content: 'You’re invited. Check your camera and microphone, then join in your browser. No account needed.' },
      { property: 'og:title', content: 'You’re invited — join the call on PeerCall' },
      { property: 'og:description', content: 'Check your camera and microphone, then join. No account or download needed.' },
      { property: 'og:image', content: 'https://peercall.fly.dev/og-join.png' },
      { property: 'og:image:alt', content: 'You’re invited. Join the call in your browser with PeerCall.' },
      { name: 'twitter:title', content: 'Join the call — PeerCall' },
      { name: 'twitter:description', content: 'You’re invited. No account or download needed.' },
      { name: 'twitter:image', content: 'https://peercall.fly.dev/og-join.png' },
    ],
  }),
  component: RoomPage,
})

function RoomPage() {
  const { roomId } = Route.useParams()
  const search = Route.useSearch()
  const isHost = search.host === 1

  const [displayName, setDisplayName] = useState('')
  const [media, setMedia] = useState<MediaHandoff | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDisplayName(localStorage.getItem('peercall_name') ?? '')
    setReady(true)
  }, [])

  if (!ready) return null

  if (!media) {
    return (
      <Lobby
        roomId={roomId}
        initialName={displayName}
        onJoin={(args) => {
          localStorage.setItem('peercall_name', args.name)
          setDisplayName(args.name)
          setMedia(args.media)
        }}
      />
    )
  }

  return (
    <Room
      roomId={roomId}
      displayName={displayName}
      isHost={isHost}
      initialMedia={media}
    />
  )
}
