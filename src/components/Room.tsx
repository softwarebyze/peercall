import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSignaling, type SignalMsg, type PeerInfo, type ChatEntry } from '../hooks/useSignaling'
import { useWebRTC } from '../hooks/useWebRTC'
import { useRecorder } from '../hooks/useRecorder'
import { VideoTile } from './VideoTile'
import { ControlsBar } from './ControlsBar'
import { ChatPanel } from './ChatPanel'
import styles from './Room.module.css'

interface RoomProps {
  roomId: string
  displayName: string
  isHost: boolean
}

export function Room({ roomId, displayName, isHost }: RoomProps) {
  const [signalMessages, setSignalMessages] = useState<SignalMsg[]>([])
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [callEnded, setCallEnded] = useState(false)
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] })
  const [copied, setCopied] = useState(false)

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
      if (msg.t === 'call_ended') setCallEnded(true)
    },
    []
  )

  const { myId, connected, send } = useSignaling({ roomId, name: displayName, isHost, onMessage: handleSignal })

  const rtc = useWebRTC({
    myId,
    sendSignal: send,
    signalMessages,
    peers,
    isHost,
    localName: displayName,
  })

  const recorder = useRecorder()

  // List available devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((list) => {
      setDevices({
        video: list.filter((d) => d.kind === 'videoinput'),
        audio: list.filter((d) => d.kind === 'audioinput'),
      })
    })
  }, [])

  // Leave on call ended
  useEffect(() => {
    if (callEnded) {
      rtc.endCall()
      window.location.href = '/'
    }
  }, [callEnded, rtc])

  // Derive isHost from server-authoritative peer list
  const isHostHere = peers.find((p) => p.id === myId)?.isHost ?? false

  const [supportsNativeShare, setSupportsNativeShare] = useState(false)
  useEffect(() => {
    setSupportsNativeShare(typeof navigator.share === 'function')
  }, [])

  const shareLink = useCallback(() => {
    const url = `${window.location.origin}/room/${roomId}`
    if (navigator.share) {
      navigator
        .share({ title: 'PeerCall', text: 'Join my PeerCall call', url })
        .catch(() => {})
      return
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        },
        () => {}
      )
    }
  }, [roomId])

  const allPeers = useMemo(() => {
    const me = {
      id: myId ?? '',
      name: displayName,
      isHost: isHostHere,
      stream: rtc.localStream,
      isLocal: true,
      connectionState: 'connected' as RTCPeerConnectionState,
    }
    const remotes = rtc.remoteStreams.map((r) => ({ ...r, isLocal: false }))
    return [me, ...remotes]
  }, [myId, displayName, isHostHere, rtc.localStream, rtc.remoteStreams])

  const handleRecordToggle = () => {
    if (recorder.recording) {
      recorder.stop()
    } else if (rtc.localStream) {
      recorder.start(rtc.localStream)
    }
  }

  return (
    <div className={styles.room}>
      {!connected && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <span className="dim">Connecting to signaling server…</span>
        </div>
      )}

      {rtc.mediaError && (
        <div className={styles.mediaError}>
          <span className={styles.mediaErrorIcon}>⚠</span>
          <span>{rtc.mediaError}</span>
        </div>
      )}

      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <div className="pulse-dot" />
          <span className="accent" style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>PeerCall</span>
          <span className="dim">·</span>
          <span className="dim" style={{ fontSize: '0.8rem' }}>{roomId}</span>
        </div>
        <div className={styles.topRight}>
          <button className="btn-ghost" onClick={shareLink} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
            {copied ? '✓ Copied' : supportsNativeShare ? '🔗 Share invite' : '🔗 Copy invite link'}
          </button>
          {recorder.recording && (
            <span className={styles.recBadge}>
              <span className={styles.recDot} />
              REC {String(Math.floor(recorder.duration / 60)).padStart(2, '0')}:{String(recorder.duration % 60).padStart(2, '0')}
            </span>
          )}
          <button
            className={participantsOpen ? styles.btnActiveSmall : 'btn-ghost'}
            onClick={() => setParticipantsOpen((v) => !v)}
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
            title="Participants"
          >
            👤 {peers.length}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={`${styles.grid} ${participantsOpen ? styles.gridNarrow : ''}`}>
          {allPeers.map((p) => (
            <VideoTile
              key={p.id}
              name={p.name}
              stream={p.stream ?? null}
              isLocal={p.isLocal}
              isHost={p.isHost}
              connectionState={p.connectionState}
            />
          ))}
        </div>

        {participantsOpen && (
          <div className={styles.participantsPanel}>
            <div className={styles.participantsHeader}>
              <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Participants</span>
              <span className="dim" style={{ fontSize: '0.7rem' }}>{peers.length}</span>
            </div>
            <div className={styles.participantsList}>
              {peers.map((p) => {
                const remote = rtc.remoteStreams.find((r) => r.id === p.id)
                const connState = p.id === myId ? 'connected' : (remote?.connectionState ?? 'new')
                const stateDot = connState === 'connected' ? styles.dotGreen
                  : connState === 'failed' ? styles.dotRed
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
        onToggleCamera={() => rtc.setCamera(!rtc.cameraOn)}
        onToggleMic={() => rtc.setMic(!rtc.micOn)}
        onShareScreen={rtc.shareScreen}
        onStopScreen={rtc.stopScreen}
        onRecordToggle={handleRecordToggle}
        onToggleChat={() => setChatOpen((v) => !v)}
        onSwitchDevice={rtc.switchDevice}
        onLeave={() => { rtc.endCall(); window.location.href = '/' }}
        onEndCall={() => { rtc.endCall(); window.location.href = '/' }}
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
