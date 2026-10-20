import { useRef, useState, useCallback, useEffect } from 'react'
import type { SignalMsg } from './useSignaling'
import type { MediaHandoff } from './useLocalMedia'
import { findLocalTrack, reacquireConstraints } from '../lib/media'

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

/** Prefer the negotiated slot: an answerer may also have an unused local slot. */
function senderFor(pc: RTCPeerConnection, kind: 'video' | 'audio') {
  const matching = pc.getTransceivers().filter(t => t.receiver.track.kind === kind)
  return (matching.find(t => t.mid !== null) ?? matching[0])?.sender
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
  cameraFallbackAvailable: boolean
  useDefaultCamera: () => void
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
  const preferredCameraRef = useRef<string | null>(null)
  const [cameraFallbackAvailable, setCameraFallbackAvailable] = useState(false)
  const cameraBeforeShareRef = useRef<MediaStreamTrack | null>(null)
  const sharingRef = useRef(false)
  const aliveRef = useRef(true)
  const acquisitionRef = useRef(0)
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
      // Reserve bidirectional slots so a camera/mic can be enabled later with
      // replaceTrack, without a new offer or leaving the call.
      if (!hasVideo) pc.addTransceiver('video', { direction: 'sendrecv' })
      if (!hasAudio) pc.addTransceiver('audio', { direction: 'sendrecv' })

      pc.ontrack = (ev) => {
        // Streamless reserved transceivers and camera/audio can arrive in
        // separate events. Aggregate by peer rather than overwriting audio.
        const previous = streamsRef.current.get(peerId)
        if (previous?.getTracks().includes(ev.track)) return
        // A new stream identity makes playback and mute listeners notice a
        // newly received kind, even if audio arrived before the video event.
        const remote = new MediaStream([
          ...(previous?.getTracks().filter(t => t.kind !== ev.track.kind) ?? []),
          ev.track,
        ])
        streamsRef.current.set(peerId, remote)
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
          .then(async () => {
            flushPendingCandidates(peerId)
            // Browsers may create a new receiving transceiver for an offer
            // instead of reusing an empty locally reserved slot. Configure
            // the negotiated slots before answering, including absent kinds.
            for (const transceiver of pc.getTransceivers()) {
              if (transceiver.mid === null) continue
              const kind = transceiver.receiver.track.kind as 'audio' | 'video'
              transceiver.direction = 'sendrecv'
              const local = localStreamRef.current
              const track = local?.getTracks().find(t => t.kind === kind) ?? null
              await transceiver.sender.replaceTrack(track)
              if (local) transceiver.sender.setStreams(local)
            }
          })
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
    const previous = localStreamRef.current
    if (previous && previous !== stream) {
      previous.getTracks().filter((track) => !stream.getTracks().includes(track)).forEach((track) => track.stop())
    }
    const cameraId = stream.getVideoTracks()[0]?.getSettings().deviceId
    if (cameraId) preferredCameraRef.current = cameraId
    localStreamRef.current = stream
    setCameraFallbackAvailable(false)
    setLocalStream(stream)
    setMediaError(null)
  }, [])

  const acquireMedia = useCallback(
    async (
      constraints: { video: boolean; audio: boolean },
      shouldCommit: () => boolean = () => true,
    ) => {
      const request = ++acquisitionRef.current
      setCameraFallbackAvailable(false)
      const ownsRequest = () => aliveRef.current && request === acquisitionRef.current && shouldCommit()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          ...constraints,
          video: constraints.video && preferredCameraRef.current ? { deviceId: { exact: preferredCameraRef.current } } : constraints.video,
        })
        // The caller that kicked this off may have been torn down while
        // getUserMedia was pending — unmount, or a newer acquisition/retry.
        // Only the still-owning caller may commit; anyone else stops what it
        // acquired so we never clobber a newer stream or leak live tracks.
        if (!ownsRequest()) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        takeStream(stream)
        stream.getVideoTracks().forEach((t) => {
          t.enabled = cameraOnRef.current
        })
        stream.getAudioTracks().forEach((t) => {
          t.enabled = micOnRef.current
        })
      } catch (err) {
        if (!ownsRequest()) return
        const name =
          typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
            ? err.name
            : ''
        if (constraints.video && preferredCameraRef.current && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
          setCameraFallbackAvailable(true)
          setMediaError('The selected camera is unavailable. Reconnect it and retry, or choose Use default camera.')
          return
        }
        const msg =
          name === 'NotAllowedError'
            ? 'Camera/mic access denied. Allow permissions, then retry.'
            : name === 'NotReadableError' || name === 'TrackStartError'
              ? 'Camera or microphone is busy. Close other apps using it, then retry here.'
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
    // No live stream was handed off. Re-acquire here — this is the rejoin path
    // (the lobby's stream was stopped by endCall on leave) or a fresh join with
    // no handoff. Preserve the handed-off mode: an audio-only session must not
    // suddenly request a camera that may not exist.
    let cancelled = false
    void acquireMedia(reacquireConstraints(initialMedia), () => !cancelled)
    return () => {
      cancelled = true
    }
  }, [initialMedia, acquireMedia, takeStream])

  // Tear down peer connections and stop media when the hook unmounts.
  // Closing the PCs matters: `call_ended` unmounts the room without going
  // through endCall(), and a leaked RTCPeerConnection keeps the remote peer's
  // connection alive until GC.
  useEffect(
    () => {
      aliveRef.current = true
      return () => {
        aliveRef.current = false
        acquisitionRef.current++
        for (const [id] of pcsRef.current) cleanupPC(id)
        localStreamRef.current?.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
        cameraBeforeShareRef.current?.stop()
        cameraBeforeShareRef.current = null
        sharingRef.current = false
      }
    },
    [cleanupPC]
  )

  // Keep tracks in sync with the current local stream on existing PCs
  useEffect(() => {
    if (!localStream) return
    for (const [, pc] of pcsRef.current) {
      for (const track of localStream.getTracks()) {
        const sender = senderFor(pc, track.kind as 'audio' | 'video')
        if (sender) {
          sender.replaceTrack(track).catch(() => {})
        } else {
          pc.addTrack(track, localStream)
        }
      }
    }
  }, [localStream])

  useEffect(() => {
    const camera = localStream?.getVideoTracks()[0]
    if (!camera || sharingRef.current) return
    const ended = () => setMediaError('Camera disconnected. Reconnect it, then choose Retry camera.')
    camera.addEventListener('ended', ended)
    return () => camera.removeEventListener('ended', ended)
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
      if (sharingRef.current) {
        if (cameraBeforeShareRef.current) cameraBeforeShareRef.current.enabled = on
      } else {
        localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = on))
      }
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
    if (sharingRef.current) return
    const localAtStart = localStreamRef.current
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const screenTrack = screen.getVideoTracks()[0]
      if (!screenTrack || !aliveRef.current || sharingRef.current || localAtStart !== localStreamRef.current) {
        screen.getTracks().forEach((t) => t.stop())
        return
      }
      if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail'
      // This version presents by replacing the camera sender. Separate
      // camera and screen publication will be added as a follow-up.
      if (!localStreamRef.current?.getVideoTracks()[0]) {
        screen.getTracks().forEach((t) => t.stop())
        return
      }
      sharingRef.current = true
      setScreenSharing(true)
      // Tell peers we are presenting so they can spotlight the shared screen
      // instead of leaving it in a one-third grid cell.
      sendSignal('screen_share', { sharing: true })

      screenTrack.onended = () => {
        void stopScreen()
      }

      for (const [, pc] of pcsRef.current) {
        const sender = senderFor(pc, 'video')
        if (sender) void sender.replaceTrack(screenTrack).catch(() => {})
      }

      const oldVideo = localStreamRef.current?.getVideoTracks()[0]
      if (localStreamRef.current && oldVideo) {
        cameraBeforeShareRef.current = oldVideo
        localStreamRef.current.removeTrack(oldVideo)
        localStreamRef.current.addTrack(screenTrack)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      }
    } catch {
      // user cancelled the picker
    }
  }, [sendSignal])

  const stopScreen = useCallback(async () => {
    if (!sharingRef.current) return
    sharingRef.current = false
    setScreenSharing(false)
    sendSignal('screen_share', { sharing: false })
    const local = localStreamRef.current
    const screenTrack = local?.getVideoTracks()[0]
    if (screenTrack) {
      screenTrack.onended = null
      screenTrack.stop()
      local?.removeTrack(screenTrack)
    }
    const camera = cameraBeforeShareRef.current
    cameraBeforeShareRef.current = null
    if (local && camera?.readyState === 'live') {
      camera.enabled = cameraOnRef.current
      local.addTrack(camera)
      for (const pc of pcsRef.current.values()) {
        const sender = senderFor(pc, 'video')
        if (sender) void sender.replaceTrack(camera).catch(() => {})
      }
      setLocalStream(new MediaStream(local.getTracks()))
    } else {
      camera?.stop()
      // Do not reopen the camera just because sharing ended. An explicit
      // retry keeps permission requests predictable and leaves audio working.
      if (local) setLocalStream(new MediaStream(local.getTracks()))
      if (aliveRef.current) setMediaError('Camera disconnected. Reconnect it, then choose Retry camera.')
    }
  }, [sendSignal])

  const switchDevice = useCallback(
    async (args: { kind: 'videoinput' | 'audioinput'; deviceId: string }) => {
      const trackKind = args.kind === 'videoinput' ? 'video' : 'audio'
      const ownedLocal = localStreamRef.current
      if (trackKind === 'video' && args.deviceId) preferredCameraRef.current = args.deviceId
      setCameraFallbackAvailable(false)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          [trackKind === 'video' ? 'video' : 'audio']: args.deviceId ? { deviceId: { exact: args.deviceId } } : true,
        })
        const newTrack = stream.getTracks()[0]
        const local = localStreamRef.current ?? new MediaStream()
        const oldTrack = trackKind === 'video' && sharingRef.current
          ? cameraBeforeShareRef.current
          : findLocalTrack(local, trackKind)
        if (!newTrack || !aliveRef.current || localStreamRef.current !== ownedLocal) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (trackKind === 'video') preferredCameraRef.current = newTrack.getSettings().deviceId ?? args.deviceId ?? null
        newTrack.enabled = trackKind === 'video' ? cameraOnRef.current : micOnRef.current

        if (trackKind === 'video' && sharingRef.current) {
          oldTrack?.stop()
          cameraBeforeShareRef.current = newTrack
          setMediaError(null)
          setLocalStream(new MediaStream(local.getTracks()))
          return
        }
        for (const [, pc] of pcsRef.current) {
          const sender = senderFor(pc, trackKind)
          if (sender) void sender.replaceTrack(newTrack).catch(() => {})
        }

        oldTrack?.stop()
        if (oldTrack) local.removeTrack(oldTrack)
        local.addTrack(newTrack)
        localStreamRef.current = local
        setAllowNoMedia(false)
        setLocalStream(new MediaStream(local.getTracks()))
        setMediaError(null)
      } catch (error) {
        if (!aliveRef.current || localStreamRef.current !== ownedLocal) return
        const name = error instanceof Error ? error.name : ''
        const missingCamera = trackKind === 'video' && !!args.deviceId && (name === 'NotFoundError' || name === 'OverconstrainedError')
        setCameraFallbackAvailable(missingCamera)
        if (missingCamera) {
          setMediaError('The selected camera is unavailable. Reconnect it and retry, or choose Use default camera.')
          return
        }
        const denied = name === 'NotAllowedError'
        setMediaError(denied
          ? 'Camera or microphone permission is blocked. Allow access in your browser’s site settings, then retry here.'
          : 'Could not open that device. Check it is connected and close other apps using it, then retry here.')
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
    cameraBeforeShareRef.current?.stop()
    cameraBeforeShareRef.current = null
    sharingRef.current = false
    acquisitionRef.current++
    setScreenSharing(false)
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
    cameraDeviceId: (cameraBeforeShareRef.current ?? localStream?.getVideoTracks()[0])?.getSettings().deviceId ?? null,
    micDeviceId: localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null,
    cameraFallbackAvailable,
    useDefaultCamera: () => { void switchDevice({ kind: 'videoinput', deviceId: '' }) },
    retryMedia: () => {
      setAllowNoMedia(false)
      if (localStreamRef.current?.getAudioTracks().some(t => t.readyState === 'live')) {
        void switchDevice({ kind: 'videoinput', deviceId: preferredCameraRef.current ?? '' })
      } else {
        void acquireMedia({ video: true, audio: true })
      }
    },
    joinAudioOnly: () => {
      if (sharingRef.current) void stopScreen()
      setAllowNoMedia(false)
      void acquireMedia({ video: false, audio: true })
    },
    joinListenOnly: () => {
      acquisitionRef.current++
      if (sharingRef.current) sendSignal('screen_share', { sharing: false })
      sharingRef.current = false
      setScreenSharing(false)
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      cameraBeforeShareRef.current?.stop()
      cameraBeforeShareRef.current = null
      localStreamRef.current = null
      for (const pc of pcsRef.current.values()) {
        for (const sender of pc.getSenders()) void sender.replaceTrack(null).catch(() => {})
      }
      setLocalStream(null)
      setAllowNoMedia(true)
      setMediaError(null)
    },
    hasVideo: (localStream?.getVideoTracks().length ?? 0) > 0,
    hasAudio: (localStream?.getAudioTracks().length ?? 0) > 0,
    listenOnly: allowNoMedia && !localStream,
  }
}
