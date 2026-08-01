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
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const signalUrl = getSignalUrl()
    const ws = new WebSocket(signalUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', payload: { roomId, name, isHost } }))
    }
    ws.onmessage = (ev) => {
      try {
        const msg: SignalMsg = JSON.parse(ev.data)
        if (msg.t === 'joined') {
          setMyId(msg.payload.id)
          setConnected(true)
        }
        handlerRef.current(msg)
      } catch {}
    }
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    return () => { ws.close(); wsRef.current = null; setConnected(false); }
  }, [roomId, name, isHost])

  const send = useCallback((t: string, payload: unknown) => {
    wsRef.current?.send(JSON.stringify({ t, payload }))
  }, [])

  return { myId, connected, send }
}
