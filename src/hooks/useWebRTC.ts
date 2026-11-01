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

/** Cap a sender's bitrate (and pick a quality trade-off) without renegotiating. */
async function tuneSender(
  sender: RTCRtpSender,
  maxBitrate: number,
  degradationPreference: RTCDegradationPreference
) {
  try {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    params.encodings[0].maxBitrate = maxBitrate
    params.degradationPreference = degradationPreference
    await sender.setParameters(params)
  } catch {}
}

const CAMERA_MAX_BITRATE = 1_500_000
const SCREEN_MAX_BITRATE = 2_500_000

function screenSenderFor(pc: RTCPeerConnection) {
  const videos = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video')
  const negotiated = videos.filter(t => t.mid !== null)
  return (negotiated.length > 1 ? negotiated[1] : videos[1])?.sender
}

export interface PeerStream {
  id: string
  name: string
  stream: MediaStream | null
  screenStream: MediaStream | null
  isHost: boolean
  connectionState: RTCPeerConnectionState
}

export interface WebRTCState {
  localStream: MediaStream | null
  localScreenStream: MediaStream | null
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
  const recoveryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const recoveryAttemptsRef = useRef<Map<string, number>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const preferredCameraRef = useRef<string | null>(null)
  const [cameraFallbackAvailable, setCameraFallbackAvailable] = useState(false)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  const screenRequestRef = useRef(false)
  const remoteScreenStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
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
    for (const id of new Set([...streamsRef.current.keys(), ...remoteScreenStreamsRef.current.keys()])) {
      const peer = peersRef.current.find((p) => p.id === id)
      arr.push({
        id,
        name: peer?.name ?? 'Peer',
        stream: streamsRef.current.get(id) ?? null,
        screenStream: remoteScreenStreamsRef.current.get(id) ?? null,
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

  const clearRecovery = useCallback((peerId: string) => {
    clearTimeout(recoveryTimersRef.current.get(peerId))
    recoveryTimersRef.current.delete(peerId)
    recoveryAttemptsRef.current.delete(peerId)
  }, [])

  const cleanupPC = useCallback((peerId: string) => {
    clearRecovery(peerId)
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      pc.onconnectionstatechange = null
      pc.oniceconnectionstatechange = null
      pc.ontrack = null
      pc.onicecandidate = null
      pc.close()
      pcsRef.current.delete(peerId)
    }
    streamsRef.current.delete(peerId)
    remoteScreenStreamsRef.current.delete(peerId)
    connectionStatesRef.current.delete(peerId)
    pendingCandidatesRef.current.delete(peerId)
    pendingOffersRef.current.delete(peerId)
  }, [clearRecovery])

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

  const reconnectPeerRef = useRef<(peerId: string, requested?: boolean) => void>(() => {})

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
          const sender = pc.addTrack(track, stream)
          if (track.kind === 'video') void tuneSender(sender, CAMERA_MAX_BITRATE, 'balanced')
          if (track.kind === 'video') hasVideo = true
          if (track.kind === 'audio') hasAudio = true
        }
      }
      // Reserve bidirectional slots so a camera/mic can be enabled later with
      // replaceTrack, without a new offer or leaving the call.
      if (!hasVideo) pc.addTransceiver('video', { direction: 'sendrecv' })
      if (!hasAudio) pc.addTransceiver('audio', { direction: 'sendrecv' })
      // Reserve a separate screen slot even for audio-only/listen-only peers.
      // Starting/stopping a share only swaps this track, without renegotiation.
      const screen = pc.addTransceiver('video', { direction: 'sendrecv' })
      void screen.sender.replaceTrack(screenTrackRef.current).catch(() => {})
      void tuneSender(screen.sender, SCREEN_MAX_BITRATE, 'maintain-resolution')

      pc.ontrack = (ev) => {
        // Streamless reserved transceivers and camera/audio can arrive in
        // separate events. Aggregate by peer rather than overwriting audio.
        const videos = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video' && t.mid !== null)
        const isScreen = ev.track.kind === 'video' && videos.indexOf(ev.transceiver) > 0
        const streams = isScreen ? remoteScreenStreamsRef.current : streamsRef.current
        const previous = streams.get(peerId)
        if (previous?.getTracks().includes(ev.track)) return
        // A new stream identity makes playback and mute listeners notice a
        // newly received kind, even if audio arrived before the video event.
        const remote = new MediaStream([
          ...(previous?.getTracks().filter(t => t.kind !== ev.track.kind) ?? []),
          ev.track,
        ])
        streams.set(peerId, remote)
        refreshRemote()
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal('ice', { target: peerId, data: ev.candidate.toJSON() })
        }
      }

      pc.onconnectionstatechange = () => {
        if (pcsRef.current.get(peerId) !== pc) return
        const state = pc.connectionState
        updateConnectionState(peerId, state)
        if (state === 'connected') {
          clearRecovery(peerId)
        } else if (state === 'failed') {
          reconnectPeerRef.current(peerId)
        } else if (state === 'disconnected' && !recoveryTimersRef.current.has(peerId)) {
          // Wi-Fi handoffs can recover on their own; don't renegotiate every blip.
          recoveryTimersRef.current.set(peerId, setTimeout(() => {
            recoveryTimersRef.current.delete(peerId)
            reconnectPeerRef.current(peerId)
          }, 5000))
        }
      }
      pc.oniceconnectionstatechange = () => {
        if (pcsRef.current.get(peerId) === pc && pc.iceConnectionState === 'failed') {
          reconnectPeerRef.current(peerId)
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
    [sendSignal, updateConnectionState, refreshRemote, clearRecovery]
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
    (peerId: string, requested = false) => {
      if (!aliveRef.current || !myIdRef.current) return
      if (!peersRef.current.some(p => p.id === peerId)) return
      const pc = pcsRef.current.get(peerId)
      if (!pc || pc.signalingState === 'closed') return
      if (pc.connectionState === 'connected' && !requested) {
        clearRecovery(peerId)
        return
      }
      // One offerer per pair avoids colliding restart offers. The other side
      // can request recovery even when only its own transport has failed.
      if (recoveryTimersRef.current.has(peerId)) return
      const attempt = recoveryAttemptsRef.current.get(peerId) ?? 0
      recoveryAttemptsRef.current.set(peerId, attempt + 1)
      const delay = Math.min(10000 * 2 ** Math.min(attempt, 2), 30000)
      recoveryTimersRef.current.set(peerId, setTimeout(() => {
        recoveryTimersRef.current.delete(peerId)
        reconnectPeerRef.current(peerId)
      }, delay))
      if (myIdRef.current > peerId) {
        sendSignal('ice_restart', { target: peerId })
        return
      }
      if (pc.signalingState !== 'stable') return
      // Keep the same connection, senders and playback elements while finding
      // a new network path. Closing the PC first interrupts otherwise-live media.
      void pc.createOffer({ iceRestart: true })
        .then(offer => {
          if (pcsRef.current.get(peerId) === pc && pc.signalingState === 'stable') return pc.setLocalDescription(offer)
        })
        .then(() => {
          if (pcsRef.current.get(peerId) === pc && pc.signalingState === 'have-local-offer' && pc.localDescription) {
            sendSignal('offer', { target: peerId, data: pc.localDescription.toJSON() })
          }
        })
        .catch(() => { /* The scheduled retry remains active until connected. */ })
    },
    [sendSignal, clearRecovery]
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
              const isScreen = transceiver.sender === screenSenderFor(pc)
              const track = isScreen ? screenTrackRef.current : local?.getTracks().find(t => t.kind === kind) ?? null
              await transceiver.sender.replaceTrack(track)
              if (local && !isScreen) transceiver.sender.setStreams(local)
              if (kind === 'video') void tuneSender(transceiver.sender, isScreen ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE, isScreen ? 'maintain-resolution' : 'balanced')
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
    for (const track of stream.getVideoTracks()) {
      track.contentHint = 'motion'
      void track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }).catch(() => {})
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
        screenTrackRef.current?.stop()
        screenTrackRef.current = null
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
    if (!camera) return
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

      if (msg.t === 'ice_restart') reconnectPeerRef.current(msg.payload.from, true)

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

  const stopScreen = useCallback(() => {
    const track = screenTrackRef.current
    if (!track) return
    screenTrackRef.current = null
    track.onended = null
    track.stop()

    // Drop the screen track from every sender but keep the transceiver around,
    // so the next share is instant and needs no renegotiation.
    for (const pc of pcsRef.current.values()) {
      void screenSenderFor(pc)?.replaceTrack(null).catch(() => {})
    }

    setLocalScreenStream(null)
    sharingRef.current = false
    setScreenSharing(false)
    sendSignal('screen_share', { sharing: false })
  }, [sendSignal])

  const shareScreen = useCallback(async () => {
    if (screenTrackRef.current || screenRequestRef.current || !aliveRef.current) return
    screenRequestRef.current = true
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        // 1080p/15fps keeps screen encoding cheap while staying readable.
        video: {
          frameRate: { ideal: 15 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      const screenTrack = screen.getVideoTracks()[0]
      if (!screenTrack || !aliveRef.current) {
        screen.getTracks().forEach((track) => track.stop())
        return
      }

      // Display capture forbids max constraints in the picker request. Apply
      // the encoding-friendly bounds to the selected track instead.
      await screenTrack.applyConstraints({
        frameRate: { ideal: 15, max: 20 },
        width: { max: 1920 },
        height: { max: 1080 },
      }).catch(() => {})
      if (!aliveRef.current || screenTrack.readyState === 'ended') {
        screen.getTracks().forEach((track) => track.stop())
        return
      }

      screenTrack.contentHint = 'detail'
      screenTrack.onended = () => stopScreen()
      screenTrackRef.current = screenTrack
      const screenStream = new MediaStream([screenTrack])

      for (const pc of pcsRef.current.values()) {
        const sender = screenSenderFor(pc)
        if (sender) {
          await sender.replaceTrack(screenTrack).catch(() => {})
          void tuneSender(sender, SCREEN_MAX_BITRATE, 'maintain-resolution')
        }
      }

      if (!aliveRef.current || screenTrackRef.current !== screenTrack) return
      setLocalScreenStream(screenStream)
      sharingRef.current = true
      setScreenSharing(true)
      setMediaError(null)
      sendSignal('screen_share', { sharing: true })
    } catch (err) {
      // Cancelling the browser picker is not an error.
      if ((err instanceof Error ? err.name : '') !== 'NotAllowedError') {
        setMediaError('Could not start screen sharing. Please try again.')
      }
    } finally {
      screenRequestRef.current = false
    }
  }, [sendSignal, stopScreen])

  // Re-announce an in-progress share after a signaling reconnect (new peer id).
  useEffect(() => {
    if (myId && screenTrackRef.current) {
      sendSignal('screen_share', { sharing: true })
    }
  }, [myId, sendSignal])

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
        const oldTrack = findLocalTrack(local, trackKind)
        if (!newTrack || !aliveRef.current || localStreamRef.current !== ownedLocal) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (trackKind === 'video') {
          preferredCameraRef.current = newTrack.getSettings().deviceId ?? args.deviceId ?? null
          newTrack.contentHint = 'motion'
          void newTrack.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }).catch(() => {})
        }
        newTrack.enabled = trackKind === 'video' ? cameraOnRef.current : micOnRef.current

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
    screenTrackRef.current?.stop()
    screenTrackRef.current = null
    sharingRef.current = false
    acquisitionRef.current++
    setScreenSharing(false)
    setLocalScreenStream(null)
    setLocalStream(null)
    refreshRemote()
  }, [cleanupPC, refreshRemote])

  return {
    localStream,
    localScreenStream,
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
      stopScreen()
      sharingRef.current = false
      setScreenSharing(false)
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      screenTrackRef.current?.stop()
      screenTrackRef.current = null
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
