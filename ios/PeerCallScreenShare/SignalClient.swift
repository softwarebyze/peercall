import Foundation
import WebRTC
import os

let ssLog = Logger(subsystem: "com.softwarebyze.peercall.screenshare", category: "signal")

struct SignalPeer {
    let id: String
    let name: String
    let isHost: Bool

    init?(_ dict: [String: Any]) {
        guard let id = dict["id"] as? String, let name = dict["name"] as? String else { return nil }
        self.id = id
        self.name = name
        self.isHost = dict["isHost"] as? Bool ?? false
    }
}

// Minimal signaling client mirroring the web app's wire protocol (signal/protocol.ts).
final class SignalClient {
    private var task: URLSessionWebSocketTask?

    var onJoined: ((String) -> Void)?
    var onRoomState: (([SignalPeer]) -> Void)?
    var onPeerJoined: ((SignalPeer) -> Void)?
    var onPeerLeft: ((String) -> Void)?
    var onOffer: ((String, RTCSessionDescription) -> Void)?
    var onAnswer: ((String, RTCSessionDescription) -> Void)?
    var onIce: ((String, RTCIceCandidate) -> Void)?
    var onCallEnded: (() -> Void)?
    var onDisconnect: ((String) -> Void)?

    func connect(to url: URL) {
        ssLog.info("connecting to \(url.absoluteString, privacy: .public)")
        task = URLSession.shared.webSocketTask(with: url)
        task?.resume()
        receive()
    }

    func join(roomId: String, name: String) {
        ssLog.info("joining room \(roomId, privacy: .public) as \(name, privacy: .public)")
        send(t: "join", payload: ["roomId": roomId, "name": name, "isHost": false])
    }

    func sendOffer(target: String, sdp: RTCSessionDescription) {
        ssLog.info("send offer -> \(target, privacy: .public)")
        send(t: "offer", payload: ["target": target, "data": ["type": "offer", "sdp": sdp.sdp]])
    }

    func sendAnswer(target: String, sdp: RTCSessionDescription) {
        ssLog.info("send answer -> \(target, privacy: .public)")
        send(t: "answer", payload: ["target": target, "data": ["type": "answer", "sdp": sdp.sdp]])
    }

    func sendIce(target: String, candidate: RTCIceCandidate) {
        ssLog.info("send ice -> \(target, privacy: .public)")
        send(t: "ice", payload: [
            "target": target,
            "data": [
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid as Any,
                "sdpMLineIndex": candidate.sdpMLineIndex,
            ],
        ])
    }

    func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message { self.handle(text) }
                self.receive()
            case .failure(let error):
                ssLog.error("websocket receive failed: \(error.localizedDescription, privacy: .public)")
                self.onDisconnect?(error.localizedDescription)
                self.task = nil
            }
        }
    }

    private func send(t: String, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["t": t, "payload": payload]),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = obj["t"] as? String,
              let payload = obj["payload"] as? [String: Any] else { return }
        ssLog.info("recv \(t, privacy: .public)")
        switch t {
        case "joined":
            if let id = payload["id"] as? String { onJoined?(id) }
        case "room_state":
            guard let rawPeers = payload["peers"] as? [[String: Any]] else { return }
            ssLog.info("room_state: \(rawPeers.count, privacy: .public) peers: \(rawPeers.compactMap { $0["name"] as? String }.joined(separator: ", "), privacy: .public)")
            onRoomState?(rawPeers.compactMap(SignalPeer.init))
        case "peer_joined":
            if let peer = SignalPeer(payload) { onPeerJoined?(peer) }
        case "peer_left":
            if let id = payload["id"] as? String { onPeerLeft?(id) }
        case "offer", "answer":
            guard let from = payload["from"] as? String,
                  let data = payload["data"] as? [String: Any],
                  let type = data["type"] as? String,
                  let sdp = data["sdp"] as? String else { return }
            let desc = RTCSessionDescription(type: type == "offer" ? .offer : .answer, sdp: sdp)
            if t == "offer" {
                onOffer?(from, desc)
            } else {
                onAnswer?(from, desc)
            }
        case "ice":
            guard let from = payload["from"] as? String,
                  let data = payload["data"] as? [String: Any],
                  let sdp = data["candidate"] as? String else { return }
            let candidate = RTCIceCandidate(
                sdp: sdp,
                sdpMLineIndex: data["sdpMLineIndex"] as? Int32 ?? 0,
                sdpMid: data["sdpMid"] as? String
            )
            onIce?(from, candidate)
        case "call_ended":
            onCallEnded?()
        default:
            break
        }
    }
}
