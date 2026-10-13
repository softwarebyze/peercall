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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parsePeerInfo(value: unknown): PeerInfo | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const name = asString(value.name)
  const isHost = asBoolean(value.isHost)
  if (id === null || name === null || isHost === null) return null
  return { id, name, isHost }
}

function parseChatEntry(value: unknown): ChatEntry | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const from = asString(value.from)
  const name = asString(value.name)
  const text = asString(value.text)
  const ts = asNumber(value.ts)
  if (id === null || from === null || name === null || text === null || ts === null) return null
  return { id, from, name, text, ts }
}

function parseSdp(value: unknown): RTCSessionDescriptionInit | null {
  if (!isRecord(value)) return null
  const type = value.type
  if (type !== 'offer' && type !== 'answer' && type !== 'pranswer' && type !== 'rollback') return null
  const sdp = value.sdp
  if (sdp !== undefined && typeof sdp !== 'string') return null
  return { type, sdp: typeof sdp === 'string' ? sdp : undefined }
}

function parseIce(value: unknown): RTCIceCandidateInit | null {
  if (!isRecord(value)) return null
  const candidate = value.candidate
  const sdpMid = value.sdpMid
  const sdpMLineIndex = value.sdpMLineIndex
  const usernameFragment = value.usernameFragment
  if (candidate !== undefined && typeof candidate !== 'string') return null
  if (sdpMid !== undefined && sdpMid !== null && typeof sdpMid !== 'string') return null
  if (sdpMLineIndex !== undefined && sdpMLineIndex !== null && typeof sdpMLineIndex !== 'number') return null
  if (usernameFragment !== undefined && usernameFragment !== null && typeof usernameFragment !== 'string') {
    return null
  }
  return {
    candidate: typeof candidate === 'string' ? candidate : undefined,
    sdpMid: typeof sdpMid === 'string' ? sdpMid : null,
    sdpMLineIndex: typeof sdpMLineIndex === 'number' ? sdpMLineIndex : null,
    usernameFragment: typeof usernameFragment === 'string' ? usernameFragment : undefined,
  }
}

export type ParsedSignal = { kind: 'ok'; msg: SignalMsg } | { kind: 'invalid' }

/** Validate a signaling websocket payload before it enters app state. */
export function parseSignalMsg(data: unknown): ParsedSignal {
  if (!isRecord(data) || typeof data.t !== 'string') return { kind: 'invalid' }
  const t = data.t
  const payload = data.payload

  switch (t) {
    case 'joined': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const id = asString(payload.id)
      const roomId = asString(payload.roomId)
      const isHost = asBoolean(payload.isHost)
      if (id === null || roomId === null || isHost === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'joined', payload: { id, roomId, isHost } } }
    }
    case 'room_state': {
      if (!isRecord(payload) || !Array.isArray(payload.peers) || !Array.isArray(payload.chat)) {
        return { kind: 'invalid' }
      }
      const peers: PeerInfo[] = []
      for (const item of payload.peers) {
        const peer = parsePeerInfo(item)
        if (!peer) return { kind: 'invalid' }
        peers.push(peer)
      }
      const chat: ChatEntry[] = []
      for (const item of payload.chat) {
        const entry = parseChatEntry(item)
        if (!entry) return { kind: 'invalid' }
        chat.push(entry)
      }
      return { kind: 'ok', msg: { t: 'room_state', payload: { peers, chat } } }
    }
    case 'peer_joined': {
      const peer = parsePeerInfo(payload)
      if (!peer) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'peer_joined', payload: peer } }
    }
    case 'peer_left': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const id = asString(payload.id)
      if (id === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'peer_left', payload: { id } } }
    }
    case 'offer':
    case 'answer': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const from = asString(payload.from)
      const desc = parseSdp(payload.data)
      if (from === null || desc === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t, payload: { from, data: desc } } }
    }
    case 'ice': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const from = asString(payload.from)
      const ice = parseIce(payload.data)
      if (from === null || ice === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'ice', payload: { from, data: ice } } }
    }
    case 'chat': {
      const entry = parseChatEntry(payload)
      if (!entry) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'chat', payload: entry } }
    }
    case 'call_ended': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const by = asString(payload.by)
      if (by === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'call_ended', payload: { by } } }
    }
    case 'error': {
      if (!isRecord(payload)) return { kind: 'invalid' }
      const message = asString(payload.message)
      if (message === null) return { kind: 'invalid' }
      return { kind: 'ok', msg: { t: 'error', payload: { message } } }
    }
    default:
      return { kind: 'invalid' }
  }
}
