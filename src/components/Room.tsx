import { useState, useMemo, useCallback, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { useSignaling, type SignalMsg, type PeerInfo, type ChatEntry, type SignalStatus } from '../hooks/useSignaling'
import { useWebRTC } from '../hooks/useWebRTC'
import { useRecorder } from '../hooks/useRecorder'
import { useMicLevel } from '../hooks/useMicLevel'
import { useMediaDevices } from '../hooks/useMediaDevices'
import { VideoTile } from './VideoTile'
import { ControlsBar } from './ControlsBar'
import { ChatPanel } from './ChatPanel'
import { IconCopy, IconCheck, IconPeople, IconWarn } from './Icons'
import { captureCallScreenshot } from '../lib/screenshot'
import type { MediaKind } from '../lib/devices'
import styles from './Room.module.css'

interface RoomProps {
  roomId: string
  displayName: string
  isHost: boolean
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
  onLeave: () => void
  onEnded: () => void
}) {
  const { roomId, displayName, isHost, onLeave, onEnded } = props
  const [signalMessages, setSignalMessages] = useState<SignalMsg[]>([])
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | null>(null)
  const [shotError, setShotError] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

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
  })

  const recorder = useRecorder()
  const devices = useMediaDevices({ stream: rtc.localStream })
  const micLevel = useMicLevel({ stream: rtc.localStream, active: rtc.micOn })
  const isHostHere = peers.find((p) => p.id === myId)?.isHost ?? false

  const leaveCall = useCallback(() => {
    rtc.endCall()
    disconnect()
    onLeave()
  }, [rtc, disconnect, onLeave])

  const endCallForEveryone = useCallback(() => {
    send('end_call', {})
    rtc.endCall()
    disconnect()
    onLeave()
  }, [send, rtc, disconnect, onLeave])

  const shareLink = useCallback(() => {
    const url = `${window.location.origin}/room/${roomId}`
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [roomId])

  const allPeers = useMemo(() => {
    const me = {
      id: myId ?? 'me',
      name: displayName,
      isHost: isHostHere,
      stream: rtc.localStream,
      isLocal: true,
      connectionState: 'connected' as RTCPeerConnectionState,
    }
    const remotes = peers
      .filter((p) => p.id !== myId)
      .map((p) => {
        const media = rtc.remoteStreams.find((r) => r.id === p.id)
        return {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          stream: media?.stream ?? null,
          isLocal: false,
          connectionState:
            media?.connectionState ?? rtc.connectionStates[p.id] ?? ('new' as RTCPeerConnectionState),
        }
      })
    return [me, ...remotes]
  }, [myId, displayName, isHostHere, peers, rtc.localStream, rtc.remoteStreams, rtc.connectionStates])

  const handleRecordToggle = () => {
    if (recorder.recording) {
      recorder.stop()
    } else if (rtc.localStream) {
      recorder.start(rtc.localStream)
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

  return (
    <div className={styles.room}>
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
        </div>
      )}

      {shotError && (
        <div className={styles.mediaError}>
          <IconWarn size={16} />
          <span>{shotError}</span>
        </div>
      )}

      {connected && !rtc.localStream && !rtc.mediaError && (
        <div className={styles.mediaInfo}>
          <span>Starting camera and microphone…</span>
        </div>
      )}

      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <div className="pulse-dot" />
          <span className="accent" style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>
            PeerCall
          </span>
          <span className="dim">·</span>
          <span className="dim" style={{ fontSize: '0.8rem' }}>
            {roomId}
          </span>
        </div>
        <div className={styles.topRight}>
          <button className="btn-ghost" onClick={shareLink} type="button" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? 'Copied' : 'Copy invite'}
          </button>
          {recorder.recording && (
            <span className={styles.recBadge}>
              <span className={styles.recDot} />
              REC {String(Math.floor(recorder.duration / 60)).padStart(2, '0')}:
              {String(recorder.duration % 60).padStart(2, '0')}
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
        <div ref={gridRef} className={`${styles.grid} ${participantsOpen ? styles.gridNarrow : ''}`}>
          {allPeers.map((p) => (
            <VideoTile
              key={p.id}
              name={p.name}
              stream={p.stream ?? null}
              isLocal={p.isLocal}
              isHost={p.isHost}
              connectionState={p.connectionState}
              videoOff={p.isLocal ? !rtc.cameraOn : undefined}
              micOff={p.isLocal ? !rtc.micOn : undefined}
              sinkId={speakerDeviceId}
            />
          ))}
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
      </div>

      <ControlsBar
        cameraOn={rtc.cameraOn}
        micOn={rtc.micOn}
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
        onEndCall={endCallForEveryone}
      />

      {chatOpen && (
        <ChatPanel
          chat={chat}
          myId={myId ?? ''}
          onSend={(text) => send('chat', { text })}
        />
      )}
    </div>
  )
}
