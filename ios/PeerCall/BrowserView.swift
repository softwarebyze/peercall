import SwiftUI
import WebKit

private let appURL = "https://peercall.fly.dev"

final class BrowserModel: NSObject, ObservableObject, WKScriptMessageHandler {
    @Published var pendingShareRequest = false

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "peerCall",
              let body = message.body as? [String: Any],
              body["action"] as? String == "startScreenShare" else { return }
        let roomId = body["roomId"] as? String ?? ""
        let name = body["name"] as? String ?? "Me"
        SharedDefaults.store(roomId: roomId, name: name, serverURL: appURL)
        pendingShareRequest = true
    }
}

struct BrowserView: View {
    @StateObject private var model = BrowserModel()
    @State private var showShareSheet = false

    var body: some View {
        WebView(model: model)
            .ignoresSafeArea()
            .onReceive(model.$pendingShareRequest) { show in
                if show { showShareSheet = true }
            }
            .sheet(isPresented: $showShareSheet, onDismiss: { model.pendingShareRequest = false }) {
                ShareSheet()
            }
    }
}

private struct ShareSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Share your screen")
                .font(.headline)
            Text("Tap the PeerCall icon to start broadcasting. Stop it from the red status-bar pill when you're done.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            ScreenSharePicker()
                .frame(width: 72, height: 72)
            Button("Cancel") { dismiss() }
        }
        .padding()
        .frame(height: 280)
    }
}

private struct WebView: UIViewRepresentable {
    let model: BrowserModel

    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        let model: BrowserModel

        init(_ model: BrowserModel) { self.model = model }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            model.userContentController(userContentController, didReceive: message)
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        config.defaultWebpagePreferences = preferences
        config.userContentController.add(context.coordinator, name: "peerCall")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        if let url = URL(string: appURL) {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
