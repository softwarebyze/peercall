import { useEffect, useRef, useState, useCallback } from 'react'
import { parseSignalMsg, type ChatEntry, type PeerInfo, type SignalMsg } from '../lib/signalMsg'

export type { ChatEntry, PeerInfo, SignalMsg }

function getSignalUrl(): string {
  if (typeof window === 'undefined') return ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/signal`
}

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
      let lastFrameAt = Date.now()
      let heartbeat: ReturnType<typeof setInterval> | undefined
      const probe = () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', payload: {} }))
      }
      const resumed = () => {
        if (document.visibilityState !== 'visible') return
        // Background tabs can suspend timers; give a resumed page a fresh
        // response window instead of treating that suspension as a dead link.
        lastFrameAt = Date.now()
        probe()
      }
      const stopHeartbeat = () => {
        clearInterval(heartbeat)
        document.removeEventListener('visibilitychange', resumed)
        window.removeEventListener('online', resumed)
      }
      ws.addEventListener('close', stopHeartbeat, { once: true })

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
        lastFrameAt = Date.now()
        document.addEventListener('visibilitychange', resumed)
        window.addEventListener('online', resumed)
        heartbeat = setInterval(() => {
          if (closed || wsRef.current !== ws) { stopHeartbeat(); return }
          if (document.visibilityState !== 'visible') return
          if (Date.now() - lastFrameAt > 60000) { ws.close(); return }
          probe()
        }, 20000)
      }
      ws.onmessage = (ev) => {
        if (closed) return
        lastFrameAt = Date.now()
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
        } catch {
          return
        }
        const parsed = parseSignalMsg(parsedJson)
        if (parsed.kind === 'invalid') return
        const msg = parsed.msg
        if (msg.t === 'pong') return
        if (msg.t === 'joined') {
          everConnected = true
          if (wakingTimer) clearTimeout(wakingTimer)
          setMyId(msg.payload.id)
          setStatus('connected')
        }
        handlerRef.current(msg)
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
