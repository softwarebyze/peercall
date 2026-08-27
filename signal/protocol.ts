// Shared signaling protocol — used by both dev server (signal/index.ts) and prod server (server.ts).

import type { ServerWebSocket } from "bun";

export type PeerId = string;
export type RoomId = string;

export interface Peer {
  id: PeerId;
  name: string;
  isHost: boolean;
  ws: ServerWebSocket<unknown>;
  room: RoomId;
}

export interface Room {
  id: RoomId;
  peers: Map<PeerId, Peer>;
  hostId: PeerId | null;
  chat: { id: string; from: PeerId; name: string; text: string; ts: number }[];
}

export const rooms = new Map<RoomId, Room>();
const peerByWs = new WeakMap<ServerWebSocket<unknown>, PeerId>();

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// Cache Metered Open Relay credentials briefly so /config stays fast.
let meteredCache: { at: number; servers: RTCIceServer[] } | null = null;
const METERED_CACHE_MS = 5 * 60 * 1000;

/**
 * ICE config for /config.
 *
 * Priority:
 * 1. TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL (any TURN provider / coturn)
 * 2. Free Metered Open Relay via METERED_DOMAIN + METERED_TURN_API_KEY
 *    (sign up: https://www.metered.ca/tools/openrelay/)
 * 3. STUN only — many home NATs still work; hard NATs will fail until TURN is set
 */
export async function buildIceConfig(): Promise<{ iceServers: RTCIceServer[] }> {
  const turnUrls =
    process.env.TURN_URLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (turnUrls.length > 0) {
    return {
      iceServers: [
        ...STUN_SERVERS,
        {
          urls: turnUrls,
          username: process.env.TURN_USERNAME ?? "",
          credential: process.env.TURN_CREDENTIAL ?? "",
        },
      ],
    };
  }

  const domain = process.env.METERED_DOMAIN?.trim();
  const apiKey = process.env.METERED_TURN_API_KEY?.trim();
  if (domain && apiKey) {
    if (meteredCache && Date.now() - meteredCache.at < METERED_CACHE_MS) {
      return { iceServers: meteredCache.servers };
    }
    try {
      const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const res = await fetch(
        `https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
      );
      if (res.ok) {
        const iceServers = (await res.json()) as RTCIceServer[];
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          meteredCache = { at: Date.now(), servers: iceServers };
          return { iceServers };
        }
      } else {
        console.warn(`Metered TURN credentials HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("Metered TURN credentials fetch failed:", err);
    }
  }

  return { iceServers: [...STUN_SERVERS] };
}

export function pack(t: string, payload: unknown) {
  return JSON.stringify({ t, payload });
}

export function broadcastRoomState(room: Room) {
  const peers = [...room.peers.values()].map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostId,
  }));
  for (const p of room.peers.values()) {
    p.ws.send(pack("room_state", { peers, chat: room.chat }));
  }
}

export function leaveRoom(room: Room, peer: Peer) {
  room.peers.delete(peer.id);
  for (const other of room.peers.values()) {
    other.ws.send(pack("peer_left", { id: peer.id }));
  }
  if (room.hostId === peer.id) {
    room.hostId = room.peers.size ? room.peers.keys().next().value ?? null : null;
  }
  if (room.peers.size === 0) {
    rooms.delete(room.id);
  } else {
    broadcastRoomState(room);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWire(raw: string | Buffer): { t: string; payload: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.t !== "string") return null;
  return { t: parsed.t, payload: parsed.payload };
}

function asJoin(payload: unknown): { roomId: string; name: string } | null {
  if (!isRecord(payload)) return null;
  const roomId = payload.roomId;
  const name = payload.name;
  if (typeof roomId !== "string" || typeof name !== "string") return null;
  if (!roomId || !name) return null;
  return { roomId, name };
}

function asRelay(payload: unknown): { target: string; data: unknown } | null {
  if (!isRecord(payload) || typeof payload.target !== "string") return null;
  return { target: payload.target, data: payload.data };
}

function asChat(payload: unknown): { text: string } | null {
  if (!isRecord(payload) || typeof payload.text !== "string") return null;
  return { text: payload.text };
}

export function handleMessage(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
  const msg = parseWire(raw);
  if (!msg) {
    ws.send(pack("error", { message: "bad json" }));
    return;
  }
  const { t, payload } = msg;

  if (t === "join") {
    const join = asJoin(payload);
    if (!join) {
      ws.send(pack("error", { message: "roomId and name required" }));
      return;
    }
    const { roomId, name } = join;
    const id: PeerId = crypto.randomUUID();
    peerByWs.set(ws, id);

    let room = rooms.get(roomId);
    if (!room) {
      room = { id: roomId, peers: new Map(), hostId: null, chat: [] };
      rooms.set(roomId, room);
    }
    if (room.peers.size >= 8) {
      ws.send(pack("error", { message: "room full (max 8)" }));
      return;
    }
    const peer: Peer = { id, name, isHost: false, ws, room: roomId };
    room.peers.set(id, peer);
    if (room.hostId === null) room.hostId = id;

    ws.send(pack("joined", { id, roomId, isHost: room.hostId === id }));
    for (const other of room.peers.values()) {
      if (other.id === id) continue;
      other.ws.send(pack("peer_joined", { id, name, isHost: false }));
    }
    broadcastRoomState(room);
    return;
  }

  const peerId = peerByWs.get(ws);
  if (!peerId) {
    ws.send(pack("error", { message: "not joined" }));
    return;
  }
  const roomId: RoomId | undefined = rooms.size
    ? [...rooms.values()].find((r) => r.peers.has(peerId))?.id
    : undefined;
  const room = roomId ? rooms.get(roomId) : undefined;
  if (!room) {
    ws.send(pack("error", { message: "room not found" }));
    return;
  }

  if (t === "offer" || t === "answer" || t === "ice") {
    const relay = asRelay(payload);
    if (!relay) return;
    const targetPeer = room.peers.get(relay.target);
    if (targetPeer) {
      targetPeer.ws.send(pack(t, { from: peerId, data: relay.data }));
    }
    return;
  }

  if (t === "chat") {
    const chat = asChat(payload);
    if (!chat) return;
    const entry = {
      id: crypto.randomUUID(),
      from: peerId,
      name: room.peers.get(peerId)?.name ?? "",
      text: chat.text.slice(0, 2000),
      ts: Date.now(),
    };
    room.chat = [...room.chat.slice(-199), entry];
    for (const p of room.peers.values()) {
      p.ws.send(pack("chat", entry));
    }
    return;
  }

  if (t === "end_call") {
    const peer = room.peers.get(peerId);
    if (peer && room.hostId === peerId) {
      for (const p of room.peers.values()) {
        p.ws.send(pack("call_ended", { by: peerId }));
      }
      rooms.delete(room.id);
    }
    return;
  }
}

export function handleClose(ws: ServerWebSocket<unknown>) {
  const peerId = peerByWs.get(ws);
  if (!peerId) return;
  for (const room of rooms.values()) {
    const peer = room.peers.get(peerId);
    if (peer) {
      leaveRoom(room, peer);
      break;
    }
  }
}
