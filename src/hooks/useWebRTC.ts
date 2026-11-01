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
  switchDevice: (kind: 'videoinput' | 'audioinput', deviceId: string) => Promise<void>
  endCall: () => void
  mediaError: string | null
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
  const remoteScreenStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const cameraSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  const micSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  const screenSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  const screenTransceiversRef = useRef<Map<string, RTCRtpTransceiver>>(new Map())
  const connectionStatesRef = useRef<Map<string, RTCPeerConnectionState>>(new Map())
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const pendingOffersRef = useRef<Map<string, RTCSessionDescriptionInit>>(new Map())
  const lastFailTimeRef = useRef<Map<string, number>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const localScreenStreamRef = useRef<MediaStream | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  const screenRequestRef = useRef(false)
  const mediaActiveRef = useRef(true)
  const placeholderTrackRef = useRef<MediaStreamTrack | null>(null)
  const placeholderStreamRef = useRef<MediaStream | null>(null)

  const localNameRef = useRef(localName)
  localNameRef.current = localName
  const peersRef = useRef(peers)
  peersRef.current = peers
  const myIdRef = useRef(myId)
  myIdRef.current = myId

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
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
    const ids = new Set([...streamsRef.current.keys(), ...remoteScreenStreamsRef.current.keys()])
    for (const id of ids) {
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

  const cleanupPC = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      pc.close()
      pcsRef.current.delete(peerId)
    }
    streamsRef.current.delete(peerId)
    remoteScreenStreamsRef.current.delete(peerId)
    cameraSendersRef.current.delete(peerId)
    micSendersRef.current.delete(peerId)
    screenSendersRef.current.delete(peerId)
    screenTransceiversRef.current.delete(peerId)
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

  // A m-line only gets matched/re-used during offer/answer if its sender
  // already has a track. Keep a tiny idle track for the reserved screen
  // transceiver so both peers end up sharing the same sendrecv m-line; it is
  // swapped out (or dropped) once negotiation settles.
  const getScreenPlaceholderTrack = useCallback(() => {
    if (!placeholderTrackRef.current) {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      canvas.getContext('2d')?.fillRect(0, 0, 16, 16)
      const track = canvas.captureStream(1).getVideoTracks()[0]
      if (track) track.contentHint = 'detail'
      placeholderTrackRef.current = track ?? null
      placeholderStreamRef.current = track ? new MediaStream([track]) : null
    }
    return placeholderTrackRef.current
  }, [])

  const syncScreenSender = useCallback((peerId: string) => {
    const sender = screenSendersRef.current.get(peerId)
    if (!sender) return
    const track = screenTrackRef.current
    sender.replaceTrack(track).catch(() => {})
    if (track) void tuneSender(sender, SCREEN_MAX_BITRATE, 'maintain-resolution')
  }, [])

  const createPC = useCallback(
    (peerId: string, initiator: boolean) => {
      const pc = new RTCPeerConnection(iceConfigRef.current)
      pcsRef.current.set(peerId, pc)
      connectionStatesRef.current.set(peerId, 'new')

      const local = localStreamRef.current
      if (local) {
        const cameraTrack = local.getVideoTracks()[0]
        const micTrack = local.getAudioTracks()[0]
        if (cameraTrack) {
          cameraTrack.contentHint = 'motion'
          const sender = pc.addTrack(cameraTrack, local)
          cameraSendersRef.current.set(peerId, sender)
          void tuneSender(sender, CAMERA_MAX_BITRATE, 'balanced')
        }
        if (micTrack) {
          micSendersRef.current.set(peerId, pc.addTrack(micTrack, local))
        }
      }

      // Reserve a separate video m-line for screen sharing. It exists from the
      // first offer, so starting/stopping a share only swaps a track and never
      // triggers a renegotiation. `sendrecv` lets both peers share at once.
      const placeholder = getScreenPlaceholderTrack()
      const placeholderStream = placeholderStreamRef.current
      if (placeholder && placeholderStream) {
        const sender = pc.addTrack(placeholder, placeholderStream)
        const transceiver = pc.getTransceivers().find((t) => t.sender === sender)
        if (transceiver) {
          screenTransceiversRef.current.set(peerId, transceiver)
        }
        screenSendersRef.current.set(peerId, sender)
      } else {
        const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' })
        screenTransceiversRef.current.set(peerId, transceiver)
        screenSendersRef.current.set(peerId, transceiver.sender)
      }

      pc.ontrack = (ev) => {
        // Camera is the first video m-line; any later video m-line is the
        // screen. Using m-line order is robust even if the browser recycles a
        // different local transceiver than the one we pre-created.
        const videoTransceivers = pc
          .getTransceivers()
          .filter((t) => t.receiver.track.kind === 'video' && t.mid !== null)
          .sort((a, b) => Number(a.mid) - Number(b.mid))
        const isScreen =
          ev.track.kind === 'video' &&
          (videoTransceivers.indexOf(ev.transceiver) > 0 ||
            ev.transceiver === screenTransceiversRef.current.get(peerId) ||
            ev.streams.length === 0)

        if (isScreen) {
          // If the browser handed us a different associated m-line, adopt it so
          // later share/stop swaps target the right sender.
          if (ev.transceiver !== screenTransceiversRef.current.get(peerId)) {
            screenTransceiversRef.current.set(peerId, ev.transceiver)
            screenSendersRef.current.set(peerId, ev.transceiver.sender)
          }
          let stream = remoteScreenStreamsRef.current.get(peerId)
          if (!stream) {
            stream = new MediaStream([ev.track])
            remoteScreenStreamsRef.current.set(peerId, stream)
          } else if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
            stream.addTrack(ev.track)
          }
        } else {
          const stream = ev.streams[0] ?? new MediaStream([ev.track])
          streamsRef.current.set(peerId, stream)
        }
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
            // Negotiation is done with the placeholder track; now send the real
            // screen (or nothing) without another round of renegotiation.
            syncScreenSender(peerId)
            if (pc.localDescription) {
              sendSignal('offer', { target: peerId, data: pc.localDescription.toJSON() })
            }
          })
          .catch(() => {})
      }

      return pc
    },
    [sendSignal, updateConnectionState, refreshRemote, cleanupPC, getScreenPlaceholderTrack, syncScreenSender]
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
              syncScreenSender(peerId)
              sendSignal('answer', { target: peerId, data: pc.localDescription.toJSON() })
            }
          })
          .catch(() => {})
      }
    },
    [createPC, flushPendingCandidates, sendSignal, syncScreenSender]
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
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        stream.getVideoTracks().forEach((t) => (t.contentHint = 'motion'))
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
  useEffect(() => {
    mediaActiveRef.current = true
    return () => {
      mediaActiveRef.current = false
      for (const [id] of pcsRef.current) cleanupPC(id)
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      const screenTrack = screenTrackRef.current
      screenTrackRef.current = null
      if (screenTrack) {
        screenTrack.onended = null
        screenTrack.stop()
      }
      localScreenStreamRef.current = null
      placeholderTrackRef.current?.stop()
      placeholderTrackRef.current = null
      placeholderStreamRef.current = null
    }
  }, [cleanupPC])

  // Keep camera/mic in sync with the local stream on existing PCs. Screen
  // senders are tracked separately and must never be replaced with the camera.
  useEffect(() => {
    if (!localStream) return
    const cameraTrack = localStream.getVideoTracks()[0]
    const micTrack = localStream.getAudioTracks()[0]
    for (const [peerId, pc] of pcsRef.current) {
      if (cameraTrack) {
        const sender = cameraSendersRef.current.get(peerId)
        if (sender) {
          if (sender.track !== cameraTrack) sender.replaceTrack(cameraTrack).catch(() => {})
        } else {
          cameraSendersRef.current.set(peerId, pc.addTrack(cameraTrack, localStream))
        }
      }
      if (micTrack) {
        const sender = micSendersRef.current.get(peerId)
        if (sender) {
          if (sender.track !== micTrack) sender.replaceTrack(micTrack).catch(() => {})
        } else {
          micSendersRef.current.set(peerId, pc.addTrack(micTrack, localStream))
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

  const stopScreen = useCallback(() => {
    const track = screenTrackRef.current
    if (!track) return
    screenTrackRef.current = null
    track.onended = null
    track.stop()

    // Drop the screen track from every sender but keep the transceiver around,
    // so the next share is instant and needs no renegotiation.
    for (const sender of screenSendersRef.current.values()) {
      sender.replaceTrack(null).catch(() => {})
    }

    localScreenStreamRef.current = null
    setLocalScreenStream(null)
    setScreenSharing(false)
    sendSignal('screen_state', { sharing: false })
  }, [sendSignal])

  const shareScreen = useCallback(async () => {
    if (screenTrackRef.current || screenRequestRef.current || !mediaActiveRef.current) return
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
      if (!screenTrack || !mediaActiveRef.current) {
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
      if (!mediaActiveRef.current || screenTrack.readyState === 'ended') {
        screen.getTracks().forEach((track) => track.stop())
        return
      }

      screenTrack.contentHint = 'detail'
      screenTrack.onended = () => stopScreen()
      screenTrackRef.current = screenTrack
      localScreenStreamRef.current = new MediaStream([screenTrack])

      for (const sender of screenSendersRef.current.values()) {
        sender.replaceTrack(screenTrack).catch(() => {})
        void tuneSender(sender, SCREEN_MAX_BITRATE, 'maintain-resolution')
      }

      setLocalScreenStream(localScreenStreamRef.current)
      setScreenSharing(true)
      setMediaError(null)
      sendSignal('screen_state', { sharing: true })
    } catch (err: any) {
      // Cancelling the browser picker is not an error.
      if (err?.name !== 'NotAllowedError') {
        setMediaError('Could not start screen sharing. Please try again.')
      }
    } finally {
      screenRequestRef.current = false
    }
  }, [sendSignal, stopScreen])

  // Re-announce an in-progress share after a signaling reconnect (new peer id).
  useEffect(() => {
    if (myId && screenTrackRef.current) {
      sendSignal('screen_state', { sharing: true })
    }
  }, [myId, sendSignal])

  const switchDevice = useCallback(
    async (kind: 'videoinput' | 'audioinput', deviceId: string) => {
      const trackKind = kind === 'videoinput' ? 'video' : 'audio'
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          [trackKind]: {
            deviceId: { exact: deviceId },
            ...(trackKind === 'video' ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            } : {}),
          },
        })
        const newTrack = stream.getTracks()[0]
        if (!newTrack) return
        if (trackKind === 'video') newTrack.contentHint = 'motion'

        for (const [peerId] of pcsRef.current) {
          const sender =
            trackKind === 'video'
              ? cameraSendersRef.current.get(peerId)
              : micSendersRef.current.get(peerId)
          // Only the camera sender is replaced — a screen share keeps running
          // on its own transceiver when the camera device changes.
          if (sender) sender.replaceTrack(newTrack).catch(() => {})
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
    mediaActiveRef.current = false
    stopScreen()
    for (const [id] of pcsRef.current) cleanupPC(id)
    placeholderTrackRef.current?.stop()
    placeholderTrackRef.current = null
    placeholderStreamRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    refreshRemote()
  }, [cleanupPC, refreshRemote, stopScreen])

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
  }
}
