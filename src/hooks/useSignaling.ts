import { useEffect, useRef, useState, useCallback } from 'react'

function getSignalUrl(): string {
  if (typeof window === 'undefined') return ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/signal`
}

export type PeerInfo = { id: string; name: string; isHost: boolean }
export type ChatEntry = { id: string; from: string; name: string; text: string; ts: number }

export type SignalMsg =
  | { t: 'joined'; payload: { id: string; roomId: string; isHost: boolean } }
  | { t: 'room_state'; payload: { peers: PeerInfo[]; chat: ChatEntry[] } }
  | { t: 'peer_joined'; payload: { id: string; name: string; isHost: boolean } }
  | { t: 'peer_left'; payload: { id: string } }
  | { t: 'offer'; payload: { from: string; data: RTCSessionDescriptionInit } }
  | { t: 'answer'; payload: { from: string; data: RTCSessionDescriptionInit } }
  | { t: 'ice'; payload: { from: string; data: RTCIceCandidateInit } }
  | { t: 'chat'; payload: ChatEntry }
  | { t: 'call_ended'; payload: { by: string } }
  | { t: 'error'; payload: { message: string } }

type SignalHandler = (msg: SignalMsg) => void

export type SignalStatus = 'connecting' | 'waking' | 'connected' | 'reconnecting'

const MAX_BACKOFF_MS = 5000
// If the very first connection takes this long, the server is probably doing
// a cold start (e.g. Fly machine waking up) — tell the user that.
const WAKING_AFTER_MS = 4000

export function useSignaling(opts: {
  roomId: string
  name: string
  isHost: boolean
  onMessage: SignalHandler
}) {
  const { roomId, name, isHost, onMessage } = opts
  const wsRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage
  const [myId, setMyId] = useState<string | null>(null)
  const [status, setStatus] = useState<SignalStatus>('connecting')
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    // Per-effect-run closed flag: a shared ref would let a stale socket's
    // async onclose (from strict-mode remounts or intentional close) schedule
    // a reconnect for the new run and produce ghost duplicate joins.
    let closed = false
    let attempt = 0
    let everConnected = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let wakingTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      const ws = new WebSocket(getSignalUrl())
      wsRef.current = ws

      if (!everConnected && attempt === 0) {
        wakingTimer = setTimeout(() => {
          setStatus((s) => (s === 'connecting' ? 'waking' : s))
        }, WAKING_AFTER_MS)
      }

      ws.onopen = () => {
        if (closed) {
          ws.close()
          return
        }
        attempt = 0
        ws.send(JSON.stringify({ t: 'join', payload: { roomId, name, isHost } }))
      }
      ws.onmessage = (ev) => {
        if (closed) return
        try {
          const msg: SignalMsg = JSON.parse(ev.data)
          if (msg.t === 'joined') {
            everConnected = true
            if (wakingTimer) clearTimeout(wakingTimer)
            setMyId(msg.payload.id)
            setStatus('connected')
          }
          handlerRef.current(msg)
        } catch {}
      }
      ws.onclose = () => {
        if (closed) return
        setStatus(everConnected ? 'reconnecting' : (attempt > 0 ? 'waking' : 'connecting'))
        const delay = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS)
        attempt += 1
        retryTimer = setTimeout(connect, delay)
      }
      ws.onerror = () => {
        // onclose fires after onerror; reconnect is scheduled there
      }
    }

    const stop = () => {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (wakingTimer) clearTimeout(wakingTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
    stopRef.current = stop

    connect()

    return () => {
      stop()
      setStatus('connecting')
      setMyId(null)
    }
  }, [roomId, name, isHost])

  const send = useCallback((t: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t, payload }))
    }
  }, [])

  // Intentional disconnect (leaving the call): stop auto-reconnect.
  const disconnect = useCallback(() => {
    stopRef.current()
  }, [])

  return { myId, connected: status === 'connected', status, send, disconnect }
}
