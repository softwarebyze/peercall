import { useRef, useState, useCallback, useEffect } from 'react'
import type { SignalMsg } from './useSignaling'
import type { MediaHandoff } from './useLocalMedia'

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
    if (!res.ok) return DEFAULT_ICE_SERVERS
    const data: unknown = await res.json()
    const parsed = parseIceConfig(data)
    if (parsed) return parsed
  } catch {
    // fall through to STUN-only defaults
  }
  return DEFAULT_ICE_SERVERS
}

function parseIceConfig(data: unknown): RTCConfiguration | null {
  if (typeof data !== 'object' || data === null || !('iceServers' in data)) return null
  const servers = data.iceServers
  if (!Array.isArray(servers) || servers.length === 0) return null
  return { iceServers: servers }
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
  switchDevice: (args: { kind: 'videoinput' | 'audioinput'; deviceId: string }) => Promise<void>
  endCall: () => void
  mediaError: string | null
  cameraDeviceId: string | null
  micDeviceId: string | null
  retryMedia: () => void
  joinAudioOnly: () => void
  joinListenOnly: () => void
  hasVideo: boolean
  hasAudio: boolean
  listenOnly: boolean
}

export function useWebRTC(opts: {
  myId: string | null
  sendSignal: (t: string, p: unknown) => void
  signalMessages: SignalMsg[]
  peers: { id: string; name: string; isHost: boolean }[]
  localName: string
  initialMedia: MediaHandoff | null
}): WebRTCState {
  const { myId, sendSignal, signalMessages, peers, localName, initialMedia } = opts

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
  const [cameraOn, setCameraOn] = useState(() =>
    initialMedia?.kind === 'stream' ? initialMedia.cameraOn : true,
  )
  const [micOn, setMicOn] = useState(() =>
    initialMedia?.kind === 'stream' ? initialMedia.micOn : true,
  )
  const [screenSharing, setScreenSharing] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [allowNoMedia, setAllowNoMedia] = useState(initialMedia?.kind === 'listen')
  const allowNoMediaRef = useRef(allowNoMedia)
  allowNoMediaRef.current = allowNoMedia
  const cameraOnRef = useRef(initialMedia?.kind === 'stream' ? initialMedia.cameraOn : true)
  const micOnRef = useRef(initialMedia?.kind === 'stream' ? initialMedia.micOn : true)
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

      const stream = localStreamRef.current
      let hasVideo = false
      let hasAudio = false
      if (stream) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream)
          if (track.kind === 'video') hasVideo = true
          if (track.kind === 'audio') hasAudio = true
        }
      }
      // Audio-only / listen-only still need recv m-lines for the other side.
      if (!hasVideo) pc.addTransceiver('video', { direction: 'recvonly' })
      if (!hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' })

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

      if (initiator) {
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
      if (!localStreamRef.current && !allowNoMediaRef.current) return
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
      if ((!localStreamRef.current && !allowNoMediaRef.current) || !iceReadyRef.current) {
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
    if (!myId || !iceReady) return
    if (!localStream && !allowNoMedia) return
    for (const peer of peers) {
      if (peer.id === myId) continue
      if (!pcsRef.current.has(peer.id)) {
        const shouldInitiate = myId < peer.id
        createPC(peer.id, shouldInitiate)
      }
    }
    for (const [peerId, data] of pendingOffersRef.current) {
      pendingOffersRef.current.delete(peerId)
      acceptOffer(peerId, data)
    }
  }, [peers, myId, localStream, iceReady, allowNoMedia, createPC, acceptOffer])

  const takeStream = useCallback((stream: MediaStream) => {
    localStreamRef.current = stream
    setLocalStream(stream)
    setMediaError(null)
  }, [])

  const acquireMedia = useCallback(
    async (constraints: { video: boolean; audio: boolean }) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        takeStream(stream)
        stream.getVideoTracks().forEach((t) => {
          t.enabled = cameraOnRef.current
        })
        stream.getAudioTracks().forEach((t) => {
          t.enabled = micOnRef.current
        })
      } catch (err) {
        const name =
          typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
            ? err.name
            : ''
        const msg =
          name === 'NotAllowedError'
            ? 'Camera/mic access denied. Allow permissions, then retry.'
            : name === 'NotFoundError'
              ? 'No camera or mic found on this device.'
              : 'Could not access camera or mic.'
        setMediaError(msg)
      }
    },
    [takeStream],
  )

  // Init local media from the lobby handoff, or request it here (rejoin).
  useEffect(() => {
    if (!myId) return
    if (localStreamRef.current) return
    if (initialMedia?.kind === 'listen') {
      setAllowNoMedia(true)
      setMediaError(null)
      return
    }
    if (initialMedia?.kind === 'stream') {
      const live = initialMedia.stream.getTracks().some((t) => t.readyState === 'live')
      if (live) {
        takeStream(initialMedia.stream)
        return
      }
    }
    let cancelled = false
    void acquireMedia({ video: true, audio: true }).then(() => {
      if (cancelled && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    })
    return () => {
      cancelled = true
    }
  }, [myId, initialMedia, acquireMedia, takeStream])

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
      if (!screenTrack) return
      setScreenSharing(true)

      screenTrack.onended = () => {
        void stopScreen()
      }

      for (const [, pc] of pcsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) void sender.replaceTrack(screenTrack)
      }

      const oldVideo = localStreamRef.current?.getVideoTracks()[0]
      if (localStreamRef.current && oldVideo) {
        localStreamRef.current.removeTrack(oldVideo)
        localStreamRef.current.addTrack(screenTrack)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      }
    } catch {
      // user cancelled the picker
    }
  }, [])

  const stopScreen = useCallback(async () => {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const camTrack = camStream.getVideoTracks()[0]
      if (!camTrack) return
      setScreenSharing(false)

      for (const [, pc] of pcsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) void sender.replaceTrack(camTrack)
      }

      const oldScreen = localStreamRef.current?.getVideoTracks()[0]
      oldScreen?.stop()
      if (localStreamRef.current && oldScreen) {
        localStreamRef.current.removeTrack(oldScreen)
        localStreamRef.current.addTrack(camTrack)
      }
      camTrack.enabled = cameraOnRef.current

      if (localStreamRef.current) setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    } catch {
      // camera may be gone
    }
  }, [])

  const switchDevice = useCallback(
    async (args: { kind: 'videoinput' | 'audioinput'; deviceId: string }) => {
      const trackKind = args.kind === 'videoinput' ? 'video' : 'audio'
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          [trackKind === 'video' ? 'video' : 'audio']: { deviceId: { exact: args.deviceId } },
        })
        const newTrack = stream.getTracks()[0]
        if (!newTrack) return

        for (const [, pc] of pcsRef.current) {
          const sender = pc.getSenders().find((s) => s.track?.kind === trackKind)
          if (sender) void sender.replaceTrack(newTrack)
        }

        const oldTrack = localStreamRef.current?.getTracks().find((t) => t.kind === trackKind)
        oldTrack?.stop()
        if (localStreamRef.current && oldTrack) {
          localStreamRef.current.removeTrack(oldTrack)
          localStreamRef.current.addTrack(newTrack)
        }
        newTrack.enabled = trackKind === 'video' ? cameraOnRef.current : micOnRef.current

        if (localStreamRef.current) setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      } catch {
        // device may have disappeared
      }
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
    cameraDeviceId: localStream?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    micDeviceId: localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null,
    retryMedia: () => {
      setAllowNoMedia(false)
      void acquireMedia({ video: true, audio: true })
    },
    joinAudioOnly: () => {
      setAllowNoMedia(false)
      void acquireMedia({ video: false, audio: true })
    },
    joinListenOnly: () => {
      setAllowNoMedia(true)
      setMediaError(null)
    },
    hasVideo: (localStream?.getVideoTracks().length ?? 0) > 0,
    hasAudio: (localStream?.getAudioTracks().length ?? 0) > 0,
    listenOnly: allowNoMedia && !localStream,
  }
}
