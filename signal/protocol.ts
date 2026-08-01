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

export function handleMessage(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
  let msg: { t: string; payload: any };
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(pack("error", { message: "bad json" }));
    return;
  }
  const { t, payload } = msg;

  if (t === "join") {
    const { roomId, name } = payload as { roomId: string; name: string };
    if (!roomId || !name) {
      ws.send(pack("error", { message: "roomId and name required" }));
      return;
    }
    (ws as any).peerId = crypto.randomUUID();
    const id: PeerId = (ws as any).peerId;

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

  const peerId: PeerId | undefined = (ws as any).peerId;
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
    const { target, data } = payload as { target: string; data: any };
    const targetPeer = room.peers.get(target);
    if (targetPeer) {
      targetPeer.ws.send(pack(t, { from: peerId, data }));
    }
    return;
  }

  if (t === "chat") {
    const { text } = payload as { text: string };
    const entry = {
      id: crypto.randomUUID(),
      from: peerId,
      name: room.peers.get(peerId)?.name ?? "",
      text: text.slice(0, 2000),
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
  const peerId: PeerId | undefined = (ws as any).peerId;
  if (!peerId) return;
  for (const room of rooms.values()) {
    const peer = room.peers.get(peerId);
    if (peer) {
      leaveRoom(room, peer);
      break;
    }
  }
}
