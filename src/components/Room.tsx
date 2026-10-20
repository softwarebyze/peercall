import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSignaling, type SignalMsg, type PeerInfo, type ChatEntry } from '../hooks/useSignaling'
import { useWebRTC } from '../hooks/useWebRTC'
import { useRecorder } from '../hooks/useRecorder'
import { VideoTile } from './VideoTile'
import { ControlsBar } from './ControlsBar'
import { ChatPanel } from './ChatPanel'
import { useElementSize } from '../hooks/useElementSize'
import { gridTracks, resolveLayout } from '../lib/layout'
import styles from './Room.module.css'

interface RoomProps {
  roomId: string
  displayName: string
  isHost: boolean
}

const statusCopy: Record<string, string> = {
  connecting: 'Connecting to signaling server…',
  waking: 'Waking up the server… this can take a few seconds after it has been idle.',
  reconnecting: 'Connection lost — reconnecting to server…',
}

export function Room({ roomId, displayName, isHost }: RoomProps) {
  const [signalMessages, setSignalMessages] = useState<SignalMsg[]>([])
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [callEnded, setCallEnded] = useState(false)
  const [left, setLeft] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] })
  const [copied, setCopied] = useState(false)
  const [layoutRef, layoutSize] = useElementSize<HTMLDivElement>()

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
      if (msg.t === 'error') setSignalError(msg.payload.message)
      if (msg.t === 'joined') setSignalError(null)
    },
    []
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

  // List available devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((list) => {
      setDevices({
        video: list.filter((d) => d.kind === 'videoinput'),
        audio: list.filter((d) => d.kind === 'audioinput'),
      })
    })
  }, [])

  // Derive isHost from server-authoritative peer list
  const isHostHere = peers.find((p) => p.id === myId)?.isHost ?? false

  const leaveCall = useCallback(() => {
    rtc.endCall()
    disconnect()
    setLeft(true)
  }, [rtc, disconnect])

  const endCallForEveryone = useCallback(() => {
    send('end_call', {})
    rtc.endCall()
    disconnect()
    setLeft(true)
  }, [send, rtc, disconnect])

  // Host ended the call for everyone → show the ended screen (not a hard redirect)
  useEffect(() => {
    if (callEnded && !left) {
      rtc.endCall()
      disconnect()
    }
  }, [callEnded, left, rtc, disconnect])

  const shareLink = useCallback(() => {
    const url = `${window.location.origin}/room/${roomId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [roomId])

  // Every peer the server knows about gets a tile — with an avatar and status
  // while their media is still connecting, instead of being invisible.
  const allPeers = useMemo(() => {
    const me = {
      id: myId ?? 'me',
      name: displayName,
      isHost: isHostHere,
      sharing: rtc.screenSharing,
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
          sharing: p.sharing ?? false,
          stream: media?.stream ?? null,
          isLocal: false,
          connectionState:
            media?.connectionState ?? rtc.connectionStates[p.id] ?? ('new' as RTCPeerConnectionState),
        }
      })
    return [me, ...remotes]
  }, [myId, displayName, isHostHere, peers, rtc.localStream, rtc.remoteStreams, rtc.connectionStates, rtc.screenSharing])

  const aspect = layoutSize.height > 0 ? layoutSize.width / layoutSize.height : 16 / 9
  const layout = resolveLayout({
    tiles: allPeers.map((p) => ({ id: p.id, sharing: p.sharing, isLocal: p.isLocal })),
    aspect,
  })
  const spotlight = layout.mode === 'spotlight' ? layout : null
  const shares = layout.mode === 'shares' ? layout : null
  const gridLayout = layout.mode === 'grid' ? layout : null
  const stageTile = spotlight ? (allPeers.find((p) => p.id === spotlight.stageId) ?? null) : null
  const shareIds = shares ? new Set(shares.stageIds) : null
  const shareTiles = shares
    ? shares.stageIds
        .map((id) => allPeers.find((p) => p.id === id))
        .filter((p): p is (typeof allPeers)[number] => p !== undefined)
    : []
  // A sharer's camera is replaced by their screen, so they belong on the stage
  // and never also in the filmstrip.
  const strip = spotlight
    ? allPeers.filter((p) => p.id !== spotlight.stageId)
    : shareIds
      ? allPeers.filter((p) => !shareIds.has(p.id))
      : []
  const tracks = gridLayout ? gridTracks(allPeers.length, gridLayout.cols, gridLayout.rows) : null
  const shareTracks = shares ? gridTracks(shareTiles.length, shares.cols, shares.rows) : null
  // Tiles are uniform; only the first tile of a short last row is nudged right
  // so the row is centered instead of left-hugging with a gap on the right.
  const columnFor = (index: number, at: ReturnType<typeof gridTracks> | null): string | undefined => {
    if (!at) return undefined
    if (index === at.lastRowStart && at.lastRowOffset > 0) {
      return `${1 + at.lastRowOffset} / span ${at.span}`
    }
    return `span ${at.span}`
  }
  const tileColumn = (index: number) => columnFor(index, tracks)
  const shareColumn = (index: number) => columnFor(index, shareTracks)

  const renderTile = (p: (typeof allPeers)[number], variant: 'grid' | 'strip' | 'stage', gridColumn?: string) => (
    <VideoTile
      key={p.id}
      name={p.name}
      stream={p.stream}
      isLocal={p.isLocal}
      isHost={p.isHost}
      connectionState={p.connectionState}
      videoOff={p.isLocal ? !rtc.cameraOn : undefined}
      micOff={p.isLocal ? !rtc.micOn : undefined}
      variant={variant}
      sharing={p.sharing}
      gridColumn={gridColumn}
    />
  )

  const handleRecordToggle = () => {
    if (recorder.recording) {
      recorder.stop()
    } else if (rtc.localStream) {
      recorder.start(rtc.localStream)
    }
  }

  if (callEnded && !left) {
    return (
      <div className={styles.endScreen}>
        <h2 style={{ margin: 0, letterSpacing: '-0.03em' }}>Call ended</h2>
        <p className="dim">The host ended this call for everyone.</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a className="btn-primary" href="/">Back to home</a>
        </div>
      </div>
    )
  }

  if (left) {
    return (
      <div className={styles.endScreen}>
        <h2 style={{ margin: 0, letterSpacing: '-0.03em' }}>You left the call</h2>
        <p className="dim">
          Room <span className="accent">{roomId}</span> — you can rejoin as long as someone is still in it.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Rejoin
          </button>
          <a className="btn-ghost" href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.room}>
      {!connected && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <span className="dim" style={{ maxWidth: 320, textAlign: 'center' }}>
            {statusCopy[status] ?? statusCopy.connecting}
          </span>
        </div>
      )}

      {signalError && (
        <div className={styles.mediaError}>
          <span className={styles.mediaErrorIcon}>⚠</span>
          <span>{signalError}</span>
        </div>
      )}

      {rtc.mediaError && (
        <div className={styles.mediaError}>
          <span className={styles.mediaErrorIcon}>⚠</span>
          <span>{rtc.mediaError}</span>
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
          <span className="accent" style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>PeerCall</span>
          <span className="dim">·</span>
          <span className="dim" style={{ fontSize: '0.8rem' }}>{roomId}</span>
        </div>
        <div className={styles.topRight}>
          <button className="btn-ghost" onClick={shareLink} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
            {copied ? '✓ Copied' : '🔗 Copy invite link'}
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
        {spotlight && stageTile ? (
          <div
            ref={layoutRef}
            className={`${styles.spotlight} ${participantsOpen ? styles.gridNarrow : ''}`}
            data-layout="spotlight"
          >
            <div className={styles.stage}>{renderTile(stageTile, 'stage')}</div>
            {strip.length > 0 && (
              <div className={styles.strip} data-testid="filmstrip">
                {strip.map((p) => (
                  <div key={p.id} className={styles.stripItem}>
                    {renderTile(p, 'strip')}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : shares && shareTracks && shareTiles.length > 0 ? (
          <div
            ref={layoutRef}
            className={`${styles.spotlight} ${participantsOpen ? styles.gridNarrow : ''}`}
            data-layout="shares"
          >
            <div
              className={styles.stageGrid}
              data-testid="share-stage"
              style={{
                gridTemplateColumns: `repeat(${shareTracks.unit}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${shares.rows}, minmax(0, 1fr))`,
              }}
            >
              {shareTiles.map((p, i) => renderTile(p, 'stage', shareColumn(i)))}
            </div>
            {strip.length > 0 && (
              <div className={styles.strip} data-testid="filmstrip">
                {strip.map((p) => (
                  <div key={p.id} className={styles.stripItem}>
                    {renderTile(p, 'strip')}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : gridLayout ? (
          <div
            ref={layoutRef}
            className={`${styles.grid} ${participantsOpen ? styles.gridNarrow : ''}`}
            data-layout={`grid-${gridLayout.cols}x${gridLayout.rows}`}
            style={{
              gridTemplateColumns: `repeat(${tracks ? tracks.unit : gridLayout.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridLayout.rows}, minmax(0, 1fr))`,
            }}
          >
            {allPeers.map((p, i) => renderTile(p, 'grid', tileColumn(i)))}
          </div>
        ) : null}

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
