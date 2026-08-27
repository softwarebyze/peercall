const ROOM_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{2,63}$/

export type RoomUrlParse =
  | { kind: 'room'; roomId: string }
  | {
      kind: 'invalid'
      reason: 'empty' | 'not_url' | 'wrong_origin' | 'not_room_path' | 'bad_room_id'
    }

export type RoomParseMode = 'qr' | 'paste'

function roomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([a-zA-Z0-9][a-zA-Z0-9-]{0,63})$/)
  if (!match) return null
  const id = match[1]
  return ROOM_ID.test(id) ? id : null
}

/** Parse a QR payload or a pasted invite into a room id. QR is origin-strict. */
export function parseRoomJoin(args: {
  text: string
  origin: string
  mode: RoomParseMode
}): RoomUrlParse {
  const trimmed = args.text.trim()
  if (!trimmed) return { kind: 'invalid', reason: 'empty' }

  if (args.mode === 'paste' && ROOM_ID.test(trimmed) && !trimmed.includes('://')) {
    return { kind: 'room', roomId: trimmed }
  }

  if (args.mode === 'paste' && trimmed.startsWith('/')) {
    const id = roomIdFromPath(trimmed.split('?')[0] ?? trimmed)
    if (!id) return { kind: 'invalid', reason: 'not_room_path' }
    return { kind: 'room', roomId: id }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { kind: 'invalid', reason: 'not_url' }
  }

  if (args.mode === 'qr' && url.origin !== args.origin) {
    return { kind: 'invalid', reason: 'wrong_origin' }
  }

  const id = roomIdFromPath(url.pathname)
  if (!id) {
    return { kind: 'invalid', reason: url.pathname.startsWith('/room/') ? 'bad_room_id' : 'not_room_path' }
  }
  return { kind: 'room', roomId: id }
}
