import { useRef, useState, useCallback, useEffect } from 'react'
import type { SignalMsg } from './useSignaling'

// Fallback if /config is unreachable. STUN only — TURN comes from the server
// (/config) when TURN_* or free Metered Open Relay env vars are set.
const DEFAULT_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
}

async function fetchIceConfig(): Promise<RTCConfiguration> {
  try {
    const res = await fetch('/config')
    if (res.ok) return await res.json()
  } catch {}
  return DEFAULT_ICE_SERVERS
}

export interface PeerStream {
  id: string
  name: string
  stream: MediaStream
  isHost: boolean
  connectionState: RTCPeerConnectionState
}

export interface WebRTCState {
  localStream: MediaStream | null
  remoteStreams: PeerStream[]
  connectionStates: Record<string, RTCPeerConnectionState>
  send: (t: string, p: unknown) => void
  myId: string | null
  setCamera: (on: boolean) => void
  setMic: (on: boolean) => void
  cameraOn: boolean
  micOn: boolean
  shareScreen: () => Promise<void>
  stopScreen: () => void
  screenSharing: boolean
  switchDevice: (kind: 'videoinput' | 'audioinput', deviceId: string) => Promise<void>
  endCall: () => void
  mediaError: string | null
}

export function useWebRTC(opts: {
  myId: string | null
  sendSignal: (t: string, p: unknown) => void
  signalMessages: SignalMsg[]
  peers: { id: string; name: string; isHost: boolean }[]
  localName: string
}): WebRTCState {
  const { myId, sendSignal, signalMessages, peers, localName } = opts

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const streamsRef = useRef<Map<string, MediaStream>>(new Map())
  const connectionStatesRef = useRef<Map<string, RTCPeerConnectionState>>(new Map())
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const pendingOffersRef = useRef<Map<string, RTCSessionDescriptionInit>>(new Map())
  const lastFailTimeRef = useRef<Map<string, number>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const localNameRef = useRef(localName)
  localNameRef.current = localName
  const peersRef = useRef(peers)
  peersRef.current = peers
  const myIdRef = useRef(myId)
  myIdRef.current = myId

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<PeerStream[]>([])
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({})
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const cameraOnRef = useRef(true)
  const micOnRef = useRef(true)
  const iceConfigRef = useRef<RTCConfiguration>(DEFAULT_ICE_SERVERS)
  // Don't create peer connections until we know the real ICE config —
  // otherwise early connections start STUN-only even when TURN is available.
  const [iceReady, setIceReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchIceConfig().then((config) => {
      if (cancelled) return
      iceConfigRef.current = config
      setIceReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshRemote = useCallback(() => {
    const arr: PeerStream[] = []
    for (const [id, stream] of streamsRef.current) {
      const peer = peersRef.current.find((p) => p.id === id)
      arr.push({
        id,
        name: peer?.name ?? 'Peer',
        stream,
        isHost: peer?.isHost ?? false,
        connectionState: connectionStatesRef.current.get(id) ?? 'new',
      })
    }
    setRemoteStreams(arr)
    setConnectionStates(Object.fromEntries(connectionStatesRef.current))
  }, [])

  const updateConnectionState = useCallback(
    (peerId: string, state: RTCPeerConnectionState) => {
      connectionStatesRef.current.set(peerId, state)
      refreshRemote()
    },
    [refreshRemote]
  )

  const cleanupPC = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      pc.close()
      pcsRef.current.delete(peerId)
    }
    streamsRef.current.delete(peerId)
    connectionStatesRef.current.delete(peerId)
    pendingCandidatesRef.current.delete(peerId)
    pendingOffersRef.current.delete(peerId)
  }, [])

  // If the signaling connection dropped and we rejoined, we get a new id and
  // everyone else saw us leave. Tear down stale connections so the mesh
  // renegotiates cleanly under the new id.
  const prevMyIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevMyIdRef.current && myId && prevMyIdRef.current !== myId) {
      for (const [id] of pcsRef.current) cleanupPC(id)
      refreshRemote()
    }
    if (myId) prevMyIdRef.current = myId
  }, [myId, cleanupPC, refreshRemote])

  const reconnectPeerRef = useRef<(peerId: string) => void>(() => {})

  const createPC = useCallback(
    (peerId: string, initiator: boolean) => {
      const pc = new RTCPeerConnection(iceConfigRef.current)
      pcsRef.current.set(peerId, pc)
      connectionStatesRef.current.set(peerId, 'new')

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current)
        }
      }

      pc.ontrack = (ev) => {
        const stream =
          ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track])
        streamsRef.current.set(peerId, stream)
        refreshRemote()
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal('ice', { target: peerId, data: ev.candidate.toJSON() })
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        updateConnectionState(peerId, state)
        if (state === 'failed') {
          const now = Date.now()
          const last = lastFailTimeRef.current.get(peerId) ?? 0
          if (now - last > 5000) {
            lastFailTimeRef.current.set(peerId, now)
            cleanupPC(peerId)
            reconnectPeerRef.current(peerId)
          }
        }
      }

      if (initiator && localStreamRef.current) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription) {
              sendSignal('offer', { target: peerId, data: pc.localDescription.toJSON() })
            }
          })
          .catch(() => {})
      }

      return pc
    },
    [sendSignal, updateConnectionState, refreshRemote, cleanupPC]
  )

  const flushPendingCandidates = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId)
    const pending = pendingCandidatesRef.current.get(peerId)
    if (!pc || !pc.remoteDescription || !pending || pending.length === 0) return
    pendingCandidatesRef.current.delete(peerId)
    for (const c of pending) {
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    }
  }, [])

  const reconnectPeer = useCallback(
    (peerId: string) => {
      if (!localStreamRef.current) return
      if (!peersRef.current.some((p) => p.id === peerId)) return
      if (pcsRef.current.has(peerId)) return
      // Only the initiator sends a fresh offer; the non-initiator waits for it.
      // Both sides' connections usually fail together, so the initiator's new
      // offer re-establishes the pair.
      const initiator = (myIdRef.current ?? '') < peerId
      createPC(peerId, initiator)
    },
    [createPC]
  )
  useEffect(() => {
    reconnectPeerRef.current = reconnectPeer
  }, [reconnectPeer])

  const iceReadyRef = useRef(false)
  iceReadyRef.current = iceReady

  const acceptOffer = useCallback(
    (peerId: string, data: RTCSessionDescriptionInit) => {
      if (!localStreamRef.current || !iceReadyRef.current) {
        pendingOffersRef.current.set(peerId, data)
        return
      }
      let pc = pcsRef.current.get(peerId)
      if (!pc) {
        pc = createPC(peerId, false)
      }
      if (pc.signalingState === 'stable') {
        pc.setRemoteDescription(new RTCSessionDescription(data))
          .then(() => flushPendingCandidates(peerId))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            if (pc.localDescription) {
              sendSignal('answer', { target: peerId, data: pc.localDescription.toJSON() })
            }
          })
          .catch(() => {})
      }
    },
    [createPC, flushPendingCandidates, sendSignal]
  )

  // Create connections for all peers once we have a local stream AND the ICE
  // config. Gating on the stream ensures every offer/answer carries our
  // tracks; gating on ICE ensures TURN is included from the first candidate.
  useEffect(() => {
    if (!myId || !localStream || !iceReady) return
    for (const peer of peers) {
      if (peer.id === myId) continue
      if (!pcsRef.current.has(peer.id)) {
        const shouldInitiate = myId < peer.id
        createPC(peer.id, shouldInitiate)
      }
    }
    // Process offers that arrived before our stream was ready
    for (const [peerId, data] of pendingOffersRef.current) {
      pendingOffersRef.current.delete(peerId)
      acceptOffer(peerId, data)
    }
  }, [peers, myId, localStream, iceReady, createPC, acceptOffer])

  // Init local media. Keep the stream across signaling reconnects (myId can
  // change) — only stop tracks on unmount.
  useEffect(() => {
    if (!myId) return
    if (localStreamRef.current) return
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        localStreamRef.current = stream
        setLocalStream(stream)
        setMediaError(null)
      })
      .catch((err) => {
        if (cancelled) return
        const msg =
          err?.name === 'NotAllowedError'
            ? 'Camera/mic access denied. Please allow permissions and reload.'
            : err?.name === 'NotFoundError'
              ? 'No camera or mic found on this device.'
              : 'Could not access camera or mic.'
        setMediaError(msg)
      })
    return () => {
      cancelled = true
    }
  }, [myId])

  // Stop media only when the hook unmounts (leaving the room).
  useEffect(
    () => () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
    },
    []
  )

  // Keep tracks in sync with the current local stream on existing PCs
  useEffect(() => {
    if (!localStream) return
    for (const [, pc] of pcsRef.current) {
      const senders = pc.getSenders()
      for (const track of localStream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind)
        if (sender) {
          sender.replaceTrack(track).catch(() => {})
        } else {
          pc.addTrack(track, localStream)
        }
      }
    }
  }, [localStream])

  const processedCountRef = useRef(0)

  // Process signal messages
  useEffect(() => {
    if (!myId) return
    const messages = signalMessages.slice(processedCountRef.current)
    processedCountRef.current = signalMessages.length

    for (const msg of messages) {
      if (msg.t === 'offer' && msg.payload.from) {
        acceptOffer(msg.payload.from, msg.payload.data)
      }

      if (msg.t === 'answer' && msg.payload.from) {
        const pc = pcsRef.current.get(msg.payload.from)
        if (pc && pc.signalingState === 'have-local-offer') {
          pc.setRemoteDescription(new RTCSessionDescription(msg.payload.data))
            .then(() => flushPendingCandidates(msg.payload.from))
            .catch(() => {})
        }
      }

      if (msg.t === 'ice' && msg.payload.from) {
        const pc = pcsRef.current.get(msg.payload.from)
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(msg.payload.data)).catch(() => {})
        } else {
          const pending = pendingCandidatesRef.current.get(msg.payload.from) ?? []
          pending.push(msg.payload.data)
          pendingCandidatesRef.current.set(msg.payload.from, pending)
        }
      }

      if (msg.t === 'peer_left') {
        cleanupPC(msg.payload.id)
        refreshRemote()
      }
    }
  }, [signalMessages, myId, acceptOffer, flushPendingCandidates, cleanupPC, refreshRemote])

  const setCameraState = useCallback(
    (on: boolean) => {
      cameraOnRef.current = on
      setCameraOn(on)
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = on))
    },
    []
  )

  const setMicState = useCallback(
    (on: boolean) => {
      micOnRef.current = on
      setMicOn(on)
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = on))
    },
    []
  )

  const shareScreen = useCallback(async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const screenTrack = screen.getVideoTracks()[0]
      setScreenSharing(true)

      screenTrack.onended = () => {
        stopScreen()
      }

      // Replace video track in all PCs
      for (const [, pc] of pcsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack)
      }

      // Replace in local stream
      const oldVideo = localStreamRef.current?.getVideoTracks()[0]
      localStreamRef.current?.removeTrack(oldVideo!)
      localStreamRef.current?.addTrack(screenTrack)

      // Re-render local
      if (localStreamRef.current) setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    } catch {}
  }, [])

  const stopScreen = useCallback(async () => {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const camTrack = camStream.getVideoTracks()[0]
      setScreenSharing(false)

      for (const [, pc] of pcsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(camTrack)
      }

      const oldScreen = localStreamRef.current?.getVideoTracks()[0]
      oldScreen?.stop()
      localStreamRef.current?.removeTrack(oldScreen!)
      localStreamRef.current?.addTrack(camTrack)
      camTrack.enabled = cameraOnRef.current

      if (localStreamRef.current) setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    } catch {}
  }, [])

  const switchDevice = useCallback(
    async (kind: 'videoinput' | 'audioinput', deviceId: string) => {
      const trackKind = kind === 'videoinput' ? 'video' : 'audio'
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          [trackKind === 'video' ? 'video' : 'audio']: { deviceId: { exact: deviceId } },
        })
        const newTrack = stream.getTracks()[0]
        if (!newTrack) return

        for (const [, pc] of pcsRef.current) {
          const sender = pc.getSenders().find((s) => s.track?.kind === trackKind)
          if (sender) sender.replaceTrack(newTrack)
        }

        const oldTrack = localStreamRef.current?.getTracks().find((t) => t.kind === trackKind)
        oldTrack?.stop()
        localStreamRef.current?.removeTrack(oldTrack!)
        localStreamRef.current?.addTrack(newTrack)
        newTrack.enabled = trackKind === 'video' ? cameraOnRef.current : micOnRef.current

        if (localStreamRef.current) setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      } catch {}
    },
    []
  )

  // Tear down local media and all peer connections. Whether to also end the
  // call for everyone (host action) is decided by the caller via signaling.
  const endCall = useCallback(() => {
    for (const [id] of pcsRef.current) cleanupPC(id)
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    refreshRemote()
  }, [cleanupPC, refreshRemote])

  return {
    localStream,
    remoteStreams,
    connectionStates,
    send: sendSignal,
    myId,
    setCamera: setCameraState,
    setMic: setMicState,
    cameraOn,
    micOn,
    shareScreen,
    stopScreen,
    screenSharing,
    switchDevice,
    endCall,
    mediaError,
  }
}
