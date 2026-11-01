import { useState, useMemo, useCallback, useRef, useEffect, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { useSignaling, type SignalMsg, type PeerInfo, type ChatEntry, type SignalStatus } from '../hooks/useSignaling'
import { useWebRTC } from '../hooks/useWebRTC'
import { useRecorder } from '../hooks/useRecorder'
import { useMicLevel } from '../hooks/useMicLevel'
import { useMediaDevices } from '../hooks/useMediaDevices'
import { useElementSize } from '../hooks/useElementSize'
import type { MediaHandoff } from '../hooks/useLocalMedia'
import { VideoTile } from './VideoTile'
import { ControlsBar } from './ControlsBar'
import { ChatPanel } from './ChatPanel'
import { InviteCard } from './InviteCard'
import { IconCopy, IconCheck, IconPeople, IconWarn, IconShare } from './Icons'
import { captureCallScreenshot } from '../lib/screenshot'
import { shareInvite } from '../lib/share'
import { resolveLayout, type LayoutTile } from '../lib/layout'
import { tileSlots } from '../lib/tileSlots'
import type { MediaKind } from '../lib/devices'
import styles from './Room.module.css'

interface CallPeer {
  id: string
  name: string
  isHost: boolean
  sharing: boolean
  micOff: boolean
  stream: MediaStream | null
  isLocal: boolean
  connectionState: RTCPeerConnectionState
}

interface RoomProps {
  roomId: string
  displayName: string
  isHost: boolean
  initialMedia: MediaHandoff
}

type RoomView =
  | { kind: 'call'; session: number }
  | { kind: 'left' }
  | { kind: 'ended' }

const statusCopy = {
  connecting: 'Connecting to signaling…',
  waking: 'Waking the server. Idle machines take a few seconds.',
  reconnecting: 'Signaling dropped. Reconnecting…',
  connected: '',
} as const satisfies Record<SignalStatus, string>

export function Room(props: RoomProps) {
  const [view, setView] = useState<RoomView>({ kind: 'call', session: 0 })
  // Remember the in-call mic/camera choices so rejoin doesn't silently
  // unmute the user by falling back to the lobby's original state.
  const [mediaPrefs, setMediaPrefs] = useState(() =>
    props.initialMedia.kind === 'stream'
      ? { cameraOn: props.initialMedia.cameraOn, micOn: props.initialMedia.micOn }
      : null
  )

  const rejoinMedia: MediaHandoff =
    mediaPrefs && props.initialMedia.kind === 'stream'
      ? { ...props.initialMedia, ...mediaPrefs }
      : props.initialMedia

  switch (view.kind) {
    case 'ended':
      return (
        <div className={styles.endScreen}>
          <h2 className={styles.endTitle}>Call ended</h2>
          <p className="dim">The host ended this call for everyone.</p>
          <div className={styles.endActions}>
            <Link className="btn-primary" to="/">
              Back to home
            </Link>
          </div>
        </div>
      )
    case 'left':
      return (
        <div className={styles.endScreen}>
          <h2 className={styles.endTitle}>You left the call</h2>
          <p className="dim">
            Room <span className="accent">{props.roomId}</span> is still up if anyone remains.
          </p>
          <div className={styles.endActions}>
            <button
              className="btn-primary"
              type="button"
              onClick={() => setView({ kind: 'call', session: Date.now() })}
            >
              Rejoin
            </button>
            <Link className="btn-ghost" to="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Back to home
            </Link>
          </div>
        </div>
      )
    case 'call':
      return (
        <RoomSession
          key={view.session}
          roomId={props.roomId}
          displayName={props.displayName}
          isHost={props.isHost}
          initialMedia={rejoinMedia}
          onMediaPrefChange={setMediaPrefs}
          onLeave={() => setView({ kind: 'left' })}
          onEnded={() => setView({ kind: 'ended' })}
        />
      )
    default: {
      const _exhaustive: never = view
      return _exhaustive
    }
  }
}

function RoomSession(props: {
  roomId: string
  displayName: string
  isHost: boolean
  initialMedia: MediaHandoff
  onMediaPrefChange: (prefs: { cameraOn: boolean; micOn: boolean }) => void
  onLeave: () => void
  onEnded: () => void
}) {
  const { roomId, displayName, isHost, initialMedia, onMediaPrefChange, onLeave, onEnded } = props
  const [signalMessages, setSignalMessages] = useState<SignalMsg[]>([])
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | null>(null)
  const [shotError, setShotError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [endConfirm, setEndConfirm] = useState(false)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [controlsH, setControlsH] = useState(0)
  const [setLayoutNode, layoutSize] = useElementSize<HTMLDivElement>()
  const layoutRef = useCallback(
    (node: HTMLDivElement | null) => {
      gridRef.current = node
      setLayoutNode(node)
    },
    [setLayoutNode],
  )

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(id)
  }, [toast])

  // Panels that pin above the controls bar need its measured height (the bar
  // wraps to a different number of rows on small screens).
  useEffect(() => {
    const el = controlsRef.current
    if (!el) return
    const measure = () => setControlsH(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleSignal = useMemo(
    () => (msg: SignalMsg) => {
      setSignalMessages((prev) => [...prev, msg])
      if (msg.t === 'room_state') {
        setPeers(msg.payload.peers)
        setChat(msg.payload.chat)
      }
      if (msg.t === 'chat') {
        setChat((prev) => [...prev, msg.payload])
      }
      if (msg.t === 'call_ended') onEnded()
      if (msg.t === 'error') setSignalError(msg.payload.message)
      if (msg.t === 'joined') setSignalError(null)
    },
    [onEnded]
  )

  const { myId, connected, status, send, disconnect } = useSignaling({
    roomId,
    name: displayName,
    isHost,
    onMessage: handleSignal,
  })

  const rtc = useWebRTC({
    myId,
    sendSignal: send,
    signalMessages,
    peers,
    localName: displayName,
    initialMedia,
  })

  const micOff = rtc.listenOnly || !rtc.micOn || !rtc.hasAudio
  // Track.enabled does not communicate the user's mute intent to receivers.
  // Republish after signaling reconnects, as well as on each local change.
  useEffect(() => {
    if (connected) send('media_state', { micOn: !micOff })
  }, [connected, send, micOff])

  const recorder = useRecorder(rtc.localScreenStream)
  const devices = useMediaDevices({ stream: rtc.localStream })
  const micLevel = useMicLevel({ stream: rtc.localStream, active: rtc.micOn })
  const isHostHere = peers.find((p) => p.id === myId)?.isHost ?? false
  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${roomId}`

  // Keep the parent's rejoin preferences in sync with what the user actually
  // chose in this session.
  useEffect(() => {
    onMediaPrefChange({ cameraOn: rtc.cameraOn, micOn: rtc.micOn })
  }, [rtc.cameraOn, rtc.micOn, onMediaPrefChange])

  const leaveCall = useCallback(() => {
    if (recorder.recording) void recorder.stop()
    rtc.endCall()
    disconnect()
    onLeave()
  }, [recorder, rtc, disconnect, onLeave])

  const endCallForEveryone = useCallback(() => {
    if (recorder.recording) void recorder.stop()
    send('end_call', {})
    rtc.endCall()
    disconnect()
    onEnded()
  }, [recorder, send, rtc, disconnect, onEnded])

  const shareLink = useCallback(() => {
    void navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [inviteUrl])

  const shareRoom = useCallback(() => {
    void shareInvite({ url: inviteUrl, roomId }).then((result) => {
      if (result === 'shared') setToast('Invite shared')
      else if (result === 'unavailable')
        setToast("Sharing isn't available here — use Copy invite")
    })
  }, [inviteUrl, roomId])

  const allPeers = useMemo<CallPeer[]>(() => {
    const me: CallPeer = {
      id: myId ?? 'me',
      name: displayName,
      isHost: isHostHere,
      sharing: false,
      micOff,
      stream: rtc.localStream,
      isLocal: true,
      connectionState: 'connected',
    }
    const remotes = peers
      .filter((p) => p.id !== myId)
      .map((p): CallPeer => {
        const media = rtc.remoteStreams.find((r) => r.id === p.id)
        return {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          sharing: false,
          micOff: !p.micOn,
          stream: media?.stream ?? null,
          isLocal: false,
          connectionState:
            media?.connectionState ?? rtc.connectionStates[p.id] ?? ('new' as RTCPeerConnectionState),
        }
      })
    const screens: CallPeer[] = []
    if (rtc.screenSharing) screens.push({
      ...me, id: `${me.id}-screen`, sharing: true, isHost: false,
      stream: rtc.localScreenStream,
    })
    for (const peer of remotes) {
      if (!peers.find(p => p.id === peer.id)?.sharing) continue
      screens.push({
        ...peer, id: `${peer.id}-screen`, sharing: true, isHost: false,
        stream: rtc.remoteStreams.find(p => p.id === peer.id)?.screenStream ?? null,
      })
    }
    return [me, ...remotes, ...screens]
  }, [
    myId,
    displayName,
    isHostHere,
    peers,
    rtc.screenSharing,
    micOff,
    rtc.localStream,
    rtc.localScreenStream,
    rtc.remoteStreams,
    rtc.connectionStates,
  ])

  const alone = allPeers.length === 1
  const panelOpen = participantsOpen || chatOpen

  // Drop a focus on someone who left, so the layout falls back to the grid.
  useEffect(() => {
    if (pinnedId !== null && !allPeers.some((p) => p.id === pinnedId)) setPinnedId(null)
  }, [allPeers, pinnedId])

  const aspect = layoutSize.height > 0 ? layoutSize.width / layoutSize.height : 16 / 9
  const layout = resolveLayout({
    tiles: allPeers.map((p): LayoutTile => ({ id: p.id, sharing: p.sharing, isLocal: p.isLocal })),
    pinnedId,
    aspect,
  })
  const placement = tileSlots(allPeers.map(p => p.id), layout)
  const soloPortrait = layoutSize.width < 700

  const renderTile = (p: CallPeer) => {
    const slot = placement.slots[p.id]
    return (
      <VideoTile
        key={p.id}
        name={p.name}
        label={p.sharing ? (p.isLocal ? "Your screen" : `${p.name}’s screen`) : undefined}
        stream={p.stream}
        isLocal={p.isLocal}
        isHost={p.isHost}
        connectionState={p.connectionState}
        videoOff={p.isLocal && !p.sharing ? (rtc.listenOnly || !rtc.cameraOn || !rtc.hasVideo) : undefined}
        micOff={p.micOff}
        sinkId={speakerDeviceId}
        variant={slot.variant}
        sharing={p.sharing}
        focused={pinnedId === p.id}
        gridColumn={alone ? '1' : slot.column}
        gridRow={alone ? '1' : slot.row}
        stripOffset={slot.stripOffset}
        stripCount={slot.stripCount}
        onToggleFocus={() => setPinnedId(current => current === p.id ? null : p.id)}
      />
    )
  }

  const handleRecordToggle = () => {
    if (recorder.recording) {
      void recorder.stop().then((result) => {
        switch (result.kind) {
          case 'saved':
            setToast('Saved to Downloads')
            return
          case 'empty':
            setToast('Nothing was saved.')
            return
          case 'idle':
            return
          default: {
            const _exhaustive: never = result
            return _exhaustive
          }
        }
      })
    } else if (rtc.localStream || rtc.localScreenStream) {
      const recordingStream = new MediaStream([
        ...(rtc.localStream?.getVideoTracks().length ? rtc.localStream.getVideoTracks() : rtc.localScreenStream?.getVideoTracks() ?? []),
        ...(rtc.localStream?.getAudioTracks() ?? []),
      ])
      void recorder.start(recordingStream).then((result) => {
        switch (result.kind) {
          case 'ok':
            return
          case 'no_video':
          case 'failed':
            setToast(result.message)
            return
          default: {
            const _exhaustive: never = result
            return _exhaustive
          }
        }
      })
    }
  }

  const handleScreenshot = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    void captureCallScreenshot({ grid }).then((result) => {
      switch (result.kind) {
        case 'ok':
          setShotError(null)
          return
        case 'empty':
          setShotError('Nothing to capture yet.')
          return
        case 'failed':
          setShotError(result.message)
          return
        default: {
          const _exhaustive: never = result
          return _exhaustive
        }
      }
    })
  }, [])

  const handleSwitchDevice = useCallback(
    (args: { kind: MediaKind; deviceId: string }) => {
      switch (args.kind) {
        case 'speaker':
          setSpeakerDeviceId(args.deviceId)
          return
        case 'camera':
          void rtc.switchDevice({ kind: 'videoinput', deviceId: args.deviceId })
          return
        case 'mic':
          void rtc.switchDevice({ kind: 'audioinput', deviceId: args.deviceId })
          return
        default: {
          const _exhaustive: never = args.kind
          return _exhaustive
        }
      }
    },
    [rtc]
  )

  const recClock = `${String(Math.floor(recorder.duration / 60)).padStart(2, '0')}:${String(
    recorder.duration % 60,
  ).padStart(2, '0')}`

  return (
    <div
      className={styles.room}
      style={{ '--controls-h': `${controlsH}px` } as CSSProperties}
    >
      {!connected && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <span className="dim" style={{ maxWidth: 320, textAlign: 'center' }}>
            {statusCopy[status]}
          </span>
        </div>
      )}

      {signalError && (
        <div className={styles.mediaError}>
          <IconWarn size={16} />
          <span>{signalError}</span>
        </div>
      )}

      {rtc.mediaError && (
        <div className={styles.mediaError}>
          <IconWarn size={16} />
          <span>{rtc.mediaError}</span>
          {rtc.cameraFallbackAvailable && (
            <button className="btn-ghost" type="button" onClick={rtc.useDefaultCamera}>Use default camera</button>
          )}
          <button className="btn-ghost" type="button" onClick={rtc.retryMedia}>
            Retry camera
          </button>
          <button className="btn-ghost" type="button" onClick={rtc.joinAudioOnly}>
            Audio only
          </button>
          <button className="btn-ghost" type="button" onClick={rtc.joinListenOnly}>
            Listen only
          </button>
        </div>
      )}

      {shotError && (
        <div className={styles.mediaError}>
          <IconWarn size={16} />
          <span>{shotError}</span>
        </div>
      )}

      {connected && !rtc.localStream && !rtc.mediaError && !rtc.listenOnly && (
        <div className={styles.mediaInfo}>
          <span>Starting camera and microphone…</span>
        </div>
      )}

      {connected && rtc.listenOnly && (
        <div className={styles.mediaInfo}>
          <span>Listen-only. Your camera and microphone stay off.</span>
        </div>
      )}

      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <div className="pulse-dot" />
          <span className="accent" style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>
            PeerCall
          </span>
          <span className="dim">·</span>
          <span className={styles.roomCode}>{roomId}</span>
        </div>
        <div className={styles.topRight}>
          <button
            className="btn-ghost"
            onClick={shareLink}
            type="button"
            data-testid="copy-invite"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? 'Copied' : 'Copy invite'}
          </button>
          <button
            className="btn-ghost"
            onClick={shareRoom}
            type="button"
            data-testid="share-invite"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          >
            <IconShare size={14} />
            Share
          </button>
          {recorder.recording && (
            <span className={styles.recBadge} data-testid="rec-pill">
              <span className={styles.recDot} />
              REC {recClock}
            </span>
          )}
          <button
            className={participantsOpen ? styles.btnActiveSmall : 'btn-ghost'}
            onClick={() => setParticipantsOpen((v) => !v)}
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
            title="Participants"
            type="button"
          >
            <IconPeople size={14} /> {peers.length}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div
          ref={layoutRef}
          className={`${styles.grid} ${panelOpen ? styles.gridNarrow : ''} ${alone ? styles.soloLayout : ''}`}
          data-layout={layout.mode === 'grid' ? `grid-${layout.cols}x${layout.rows}` : layout.mode}
          data-testid="call-layout"
          style={{
            gridTemplateColumns: `repeat(${alone ? (soloPortrait ? 1 : 2) : placement.columns}, minmax(0, 1fr))`,
            gridTemplateRows: alone ? (soloPortrait ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)') : placement.rows,
          }}
        >
          {allPeers.map(renderTile)}
          {alone && <div className={styles.soloInvite}><InviteCard roomId={roomId} url={inviteUrl} /></div>}
        </div>

        {participantsOpen && (
          <div className={styles.participantsPanel}>
            <div className={styles.participantsHeader}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Participants</span>
              <span className="dim" style={{ fontSize: '0.7rem' }}>
                {peers.length}
              </span>
            </div>
            <div className={styles.participantsList}>
              {peers.map((p) => {
                const remote = rtc.remoteStreams.find((r) => r.id === p.id)
                const connState = p.id === myId ? 'connected' : (remote?.connectionState ?? 'new')
                const stateDot =
                  connState === 'connected'
                    ? styles.dotGreen
                    : connState === 'failed'
                      ? styles.dotRed
                      : styles.dotYellow
                return (
                  <div key={p.id} className={styles.participantRow}>
                    <span className={`${styles.participantDot} ${stateDot}`} />
                    <span className={styles.participantName}>
                      {p.id === myId ? `${p.name} (you)` : p.name}
                    </span>
                    {p.isHost && <span className={styles.hostBadge}>HOST</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {chatOpen && (
          <ChatPanel
            chat={chat}
            myId={myId ?? ''}
            onSend={(text) => send('chat', { text })}
          />
        )}
      </div>

      <ControlsBar
        barRef={controlsRef}
        cameraOn={rtc.cameraOn}
        micOn={rtc.micOn}
        cameraAvailable={rtc.hasVideo && !rtc.listenOnly}
        micAvailable={rtc.hasAudio && !rtc.listenOnly}
        recordAvailable={rtc.hasVideo || rtc.screenSharing}
        screenSharing={rtc.screenSharing}
        recording={recorder.recording}
        chatOpen={chatOpen}
        isHost={isHostHere}
        devices={devices}
        cameraDeviceId={rtc.cameraDeviceId}
        micDeviceId={rtc.micDeviceId}
        speakerDeviceId={speakerDeviceId}
        micLevel={micLevel}
        onToggleCamera={() => rtc.setCamera(!rtc.cameraOn)}
        onToggleMic={() => rtc.setMic(!rtc.micOn)}
        onShareScreen={() => void rtc.shareScreen()}
        onStopScreen={rtc.stopScreen}
        onRecordToggle={handleRecordToggle}
        onScreenshot={handleScreenshot}
        onToggleChat={() => setChatOpen((v) => !v)}
        onSwitchDevice={handleSwitchDevice}
        onLeave={leaveCall}
        onEndCall={() => setEndConfirm(true)}
      />

      {toast && (
        <div className={styles.toast} data-testid="toast" role="status">
          {toast}
        </div>
      )}

      {endConfirm && (
        <div className={styles.modalOverlay} onClick={() => setEndConfirm(false)} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-labelledby="end-title"
            data-testid="end-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 id="end-title" className={styles.modalTitle}>
                End for everyone?
              </h3>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmCopy}>
                This hangs up the room for every participant. You cannot undo it.
              </p>
              <div className={styles.confirmActions}>
                <button className="btn-ghost" type="button" onClick={() => setEndConfirm(false)}>
                  Cancel
                </button>
                <button
                  className="btn-danger"
                  type="button"
                  onClick={() => {
                    setEndConfirm(false)
                    endCallForEveryone()
                  }}
                >
                  End for everyone
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
