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
        signal.connect(to: URL(string: SharedDefaults.serverURL + "/signal")!)
        signal.join(roomId: SharedDefaults.roomId, name: name)
        Task { await loadIceServers() }
    }

    func capture(_ sampleBuffer: CMSampleBuffer) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let tsNs = Int64(CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds * 1_000_000_000)
        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: pixelBuffer),
            rotation: ._0,
            timeStampNs: tsNs
        )
        videoSource.capturer(capturer, didCapture: frame)
    }

    func stop() {
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

        if myId < peerId {
        pc.offer(for: constraints) { [weak self, weak pc] sdp, _ in
            guard let self, let pc, let sdp else { return }
            pc.setLocalDescription(sdp) { [weak self] _ in
                guard let self else { return }
                self.signal.sendOffer(target: peerId, sdp: sdp)
            }
        }
        }
        return pc
    }

    private func handleOffer(from: String, offer: RTCSessionDescription) {
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
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {}
}
