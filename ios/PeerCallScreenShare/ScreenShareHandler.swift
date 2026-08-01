import ReplayKit
import WebRTC

final class ScreenShareHandler: RPBroadcastSampleHandler {
    private var session: ScreenShareSession?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        ssLog.info("broadcastStarted; roomId=\(SharedDefaults.roomId, privacy: .public) name=\(SharedDefaults.name, privacy: .public) server=\(SharedDefaults.serverURL, privacy: .public)")
        guard !SharedDefaults.roomId.isEmpty else {
            finishBroadcastWithError(
                ScreenShareHandler.error(1, "No active call. Open PeerCall and join a call before sharing your screen.")
            )
            return
        }
        let session = ScreenShareSession()
        session.onFinish = { [weak self] message in
            DispatchQueue.main.async {
                self?.finishBroadcastWithError(ScreenShareHandler.error(2, message))
            }
        }
        session.start()
        self.session = session
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        session?.capture(sampleBuffer)
    }

    override func broadcastFinished() {
        session?.stop()
        session = nil
    }

    private static func error(_ code: Int, _ message: String) -> NSError {
        NSError(
            domain: "com.softwarebyze.peercall.screenshare",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
