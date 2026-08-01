import Foundation
import WebRTC

// Owns the native screen-share peer connection: joins the room as a "screen" peer,
// feeds ReplayKit frames into a single video track, and mirrors the web app's
// negotiation rules (initiator = myId < peerId, ICE candidates buffered until
// remoteDescription is set).
final class ScreenShareSession: NSObject {
    var onFinish: ((String) -> Void)?

    private let factory: RTCPeerConnectionFactory
    private let videoSource: RTCVideoSource
    private let videoTrack: RTCVideoTrack
    private let capturer: RTCVideoCapturer
    private let signal = SignalClient()

    private var myId: String?
    private var iceServers: [RTCIceServer] = []
    private var knownPeerIds: Set<String> = []
    private var pcs: [String: RTCPeerConnection] = [:]
    private var pcPeerIds: [ObjectIdentifier: String] = [:]
    private var pendingCandidates: [String: [RTCIceCandidate]] = [:]
    private var connectedPeerCount = 0
    private var frameCount: Int64 = 0
    private var watchdog: Task<Void, Never>?

    override init() {
        factory = RTCPeerConnectionFactory()
        videoSource = factory.videoSource()
        videoTrack = factory.videoTrack(with: videoSource, trackId: "screen0")
        capturer = RTCVideoCapturer(delegate: videoSource)
        super.init()
    }

    func start() {
        wireSignaling()
        let name = SharedDefaults.name.isEmpty ? "Screen share" : SharedDefaults.name + " (screen)"
        ssLog.info("start: room=\(SharedDefaults.roomId, privacy: .public) name=\(name, privacy: .public) server=\(SharedDefaults.serverURL, privacy: .public)")
        Task {
            await loadIceServers()
            ssLog.info("loaded \(self.iceServers.count, privacy: .public) ICE servers")
            signal.connect(to: URL(string: SharedDefaults.serverURL + "/signal")!)
            signal.join(roomId: SharedDefaults.roomId, name: name)
        }
        startWatchdog()
    }

    func capture(_ sampleBuffer: CMSampleBuffer) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        frameCount += 1
        if frameCount == 1 || frameCount.isMultiple(of: 300) {
            ssLog.info("captured \(self.frameCount, privacy: .public) frames")
        }
        let tsNs = Int64(CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds * 1_000_000_000)
        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: pixelBuffer),
            rotation: ._0,
            timeStampNs: tsNs
        )
        videoSource.capturer(capturer, didCapture: frame)
    }

    func stop() {
        watchdog?.cancel()
        for id in Array(pcs.keys) { closePC(id) }
        signal.close()
    }

    // MARK: - ICE config

    private func loadIceServers() async {
        guard let url = URL(string: SharedDefaults.serverURL + "/config"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let servers = json["iceServers"] as? [[String: Any]] else { return }
        var parsed: [RTCIceServer] = []
        for server in servers {
            var urls: [String] = []
            if let s = server["urls"] as? String {
                urls = [s]
            } else if let a = server["urls"] as? [String] {
                urls = a
            }
            guard !urls.isEmpty else { continue }
            parsed.append(
                RTCIceServer(
                    urlStrings: urls,
                    username: server["username"] as? String ?? "",
                    credential: server["credential"] as? String ?? ""
                )
            )
        }
        iceServers = parsed
        reconcile()
    }

    // MARK: - Signaling wiring

    private func wireSignaling() {
        signal.onJoined = { [weak self] id in
            self?.myId = id
            self?.reconcile()
        }
        signal.onRoomState = { [weak self] peers in
            guard let self else { return }
            self.knownPeerIds = Set(peers.map(\.id))
            self.reconcile()
        }
        signal.onPeerJoined = { [weak self] peer in
            guard let self else { return }
            self.knownPeerIds.insert(peer.id)
            self.reconcile()
        }
        signal.onPeerLeft = { [weak self] id in
            guard let self else { return }
            self.knownPeerIds.remove(id)
            self.reconcile()
        }
        signal.onOffer = { [weak self] from, offer in
            self?.handleOffer(from: from, offer: offer)
        }
        signal.onAnswer = { [weak self] from, answer in
            self?.handleAnswer(from: from, answer: answer)
        }
        signal.onIce = { [weak self] from, candidate in
            self?.handleIce(from: from, candidate: candidate)
        }
        signal.onCallEnded = { [weak self] in
            self?.onFinish?("The call ended.")
        }
        signal.onDisconnect = { [weak self] reason in
            ssLog.error("signaling disconnected: \(reason, privacy: .public)")
            self?.onFinish?("Lost connection to the PeerCall server (\(reason)).")
        }
    }

    private func startWatchdog() {
        watchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard let self, !Task.isCancelled else { return }
            if self.myId == nil {
                self.onFinish?("Couldn't reach the PeerCall signaling server. Check your internet connection and try again.")
                return
            }
            if self.knownPeerIds.isEmpty {
                self.onFinish?("Connected to PeerCall, but no other participants are in this call.")
                return
            }
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            guard !Task.isCancelled else { return }
            if self.connectedPeerCount == 0 {
                self.onFinish?("Connected to the call, but the video connection to the other device couldn't be established. See server logs.")
            } else {
                ssLog.info("watchdog: connected to \(self.connectedPeerCount, privacy: .public) peer(s), \(self.frameCount, privacy: .public) frames captured")
            }
        }
    }

    // MARK: - Peer management

    private func reconcile() {
        guard let myId else { return }
        knownPeerIds.remove(myId)
        for id in Array(pcs.keys) where !knownPeerIds.contains(id) {
            closePC(id)
        }
        for id in knownPeerIds where pcs[id] == nil {
            ensurePC(peerId: id)
        }
        ssLog.info("reconcile: myId=\(myId, privacy: .public) peers=\(Array(self.knownPeerIds).sorted().joined(separator: ","), privacy: .public) pcs=\(self.pcs.keys.count, privacy: .public)")
    }

    @discardableResult
    private func ensurePC(peerId: String) -> RTCPeerConnection? {
        if let existing = pcs[peerId] { return existing }
        guard let myId else { return nil }

        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.iceServers = iceServers

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            return nil
        }
        pcs[peerId] = pc
        pcPeerIds[ObjectIdentifier(pc)] = peerId
        pc.add(videoTrack, streamIds: ["screen"])
        ssLog.info("peer connection created for \(peerId, privacy: .public), initiator=\(myId < peerId, privacy: .public)")

        if myId < peerId {
            pc.offer(for: constraints) { [weak self, weak pc] sdp, error in
                guard let self, let pc, let sdp else {
                    ssLog.error("offer failed for \(peerId, privacy: .public): \(String(describing: error), privacy: .public)")
                    return
                }
                pc.setLocalDescription(sdp) { [weak self] error in
                    guard let self else { return }
                    if let error {
                        ssLog.error("setLocalDescription(offer) failed: \(error.localizedDescription, privacy: .public)")
                        return
                    }
                    self.signal.sendOffer(target: peerId, sdp: sdp)
                }
            }
        }
        return pc
    }

    private func handleOffer(from: String, offer: RTCSessionDescription) {
        ssLog.info("recv offer from \(from, privacy: .public)")
        guard let pc = ensurePC(peerId: from), pc.signalingState == .stable else { return }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc.setRemoteDescription(offer) { [weak self, weak pc] _ in
            guard let self, let pc else { return }
            self.flushPendingCandidates(for: from)
            pc.answer(for: constraints) { [weak self, weak pc] sdp, _ in
                guard let self, let pc, let sdp else { return }
                pc.setLocalDescription(sdp) { [weak self] _ in
                    guard let self else { return }
                    self.signal.sendAnswer(target: from, sdp: sdp)
                }
            }
        }
    }

    private func handleAnswer(from: String, answer: RTCSessionDescription) {
        ssLog.info("recv answer from \(from, privacy: .public)")
        guard let pc = pcs[from], pc.signalingState == .haveLocalOffer else { return }
        pc.setRemoteDescription(answer) { [weak self] _ in
            self?.flushPendingCandidates(for: from)
        }
    }

    private func handleIce(from: String, candidate: RTCIceCandidate) {
        guard let pc = pcs[from] else { return }
        if pc.remoteDescription != nil {
            pc.add(candidate, completionHandler: { _ in })
        } else {
            pendingCandidates[from, default: []].append(candidate)
        }
    }

    private func flushPendingCandidates(for peerId: String) {
        guard let pc = pcs[peerId], let pending = pendingCandidates.removeValue(forKey: peerId) else { return }
        for c in pending { pc.add(c, completionHandler: { _ in }) }
    }

    private func closePC(_ peerId: String) {
        pendingCandidates.removeValue(forKey: peerId)
        if let pc = pcs.removeValue(forKey: peerId) {
            pcPeerIds.removeValue(forKey: ObjectIdentifier(pc))
            pc.close()
        }
    }
}

// MARK: - RTCPeerConnectionDelegate

extension ScreenShareSession: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        guard let peerId = pcPeerIds[ObjectIdentifier(peerConnection)] else { return }
        signal.sendIce(target: peerId, candidate: candidate)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        guard let peerId = pcPeerIds[ObjectIdentifier(peerConnection)] else { return }
        ssLog.info("peer \(peerId, privacy: .public) ice state: \(Self.iceStateName(newState), privacy: .public)")
        if newState == .connected || newState == .completed {
            connectedPeerCount += 1
            ssLog.info("CONNECTED to \(peerId, privacy: .public); frames so far \(self.frameCount, privacy: .public)")
        }
    }

    private static func iceStateName(_ state: RTCIceConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .checking: return "checking"
        case .connected: return "connected"
        case .completed: return "completed"
        case .failed: return "failed"
        case .disconnected: return "disconnected"
        case .closed: return "closed"
        case .count: return "count"
        @unknown default: return "unknown"
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {}
}
