# PeerCall

Privacy-first peer-to-peer video calling. WebRTC mesh, local recording via MediaBunny, zero media through any server.

## Features

- **P2P Mesh** — Up to 8 participants connected directly via WebRTC. No SFU, no relay server.
- **Local Recording** — Record calls as MP4 directly to your device with MediaBunny.
- **Zero Data Collection** — No accounts, no analytics, no tracking. Media never leaves your browser.
- **In-Call Chat** — Ephemeral text messages via signaling server.
- **Screen Sharing** — Share your screen with other participants.
- **Host Controls** — First participant becomes host. Host can end call for all.

## Quick Start

### Development

```bash
bun install
bun run dev:all
```

This starts both the Vite dev server (port 3000) and the signaling server (port 8080).

Open http://localhost:3000

### Production (local)

```bash
bun run prod
```

This builds the app and starts the unified production server on port 3000 (configurable via `PORT` env var).

### Brand assets

Favicons, the OG social card, and the web app manifest are generated from source SVGs in `public/favicon.svg` and `scripts/assets/og-image.svg`:

```bash
bun run generate:assets
```

Committed assets in `public/` are served as-is by the production server.

## iOS App (screen sharing on iPhone)

Browsers on iPhone/iPad can't capture the screen (Apple doesn't expose
`getDisplayMedia`), so screen sharing there requires a native wrapper app. The
`ios/` folder is a thin SwiftUI shell that:

1. **Hosts the existing web app** in a `WKWebView` — the full calling UI,
   signaling, rooms, chat, and recording are reused as-is.
2. **Adds a ReplayKit broadcast extension** (`PeerCallScreenShare`) that joins
   the current room as a `"Name (screen)"` peer with its own minimal native
   WebRTC connection (via the `stasel/WebRTC` SPM package) streaming the
   captured frames. It mirrors the web signaling protocol, including the
   `myId < peerId` initiator rule and ICE candidate buffering.
3. **Bridges the two**: the web app detects the wrapper
   (`window.webkit.messageHandlers.peerCall`) and routes the Share button to
   the native system broadcast picker instead of `getDisplayMedia`. The room ID
   and name are passed to the extension through an App Group
   (`group.com.softwarebyze.peercall`).

### Build

```bash
brew install xcodegen
cd ios
xcodegen generate
xcodebuild -project PeerCall.xcodeproj -scheme PeerCall \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

For a real device you must set your Apple Developer team in Xcode (both
targets) so the App Group entitlement can be signed. Installing on a device
requires an Apple Developer account.

### How it works

1. Open a call in the wrapper app and tap **🖥 Share**.
2. A sheet shows the system broadcast picker — tap the PeerCall icon.
3. The extension reads the room ID from the App Group defaults, joins the room
   via the signaling WebSocket, and pushes ReplayKit screen frames into a
   single video track.
4. Every participant in the room (including desktop browsers) sees the screen
   as a new video tile.
5. Stop sharing from the red status-bar pill, or it ends automatically when the
   call ends.

The signaling server accepts native clients as-is: the CORS check only rejects
mismatched `Origin` headers, and native `URLSessionWebSocketTask` connections
send none.

## Deploy to Fly.io

### Prerequisites

1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. Log in: `flyctl auth login`

### First deploy

```bash
flyctl launch --copy-config --name peercall
flyctl deploy
```

### Subsequent deploys

```bash
flyctl deploy
```

### Custom domain

```bash
flyctl certs add yourdomain.com
```

Then update your DNS to point to Fly's nameservers.

## Deploy with Docker

```bash
docker build -t peercall .
docker run -p 3000:3000 \
  -e TURN_URLS=turn:your-turn-server:3478 \
  -e TURN_USERNAME=user \
  -e TURN_CREDENTIAL=secret \
  -e CORS_ORIGINS=https://yourdomain.com \
  peercall
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `CORS_ORIGINS` | (all) | Comma-separated allowed origins |
| `TURN_URLS` | (none) | Comma-separated TURN server URLs |
| `TURN_USERNAME` | (none) | TURN username |
| `TURN_CREDENTIAL` | (none) | TURN credential |

## TURN Server

WebRTC P2P requires a TURN server for peers behind symmetric NATs or restrictive firewalls. Without it, some connections will fail silently.

### Option 1: Self-hosted (coturn)

```bash
# Install coturn
sudo apt install coturn

# Configure /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=peercall:your-secret
realm=peercall.yourdomain.com

# Start
sudo systemctl enable coturn
sudo systemctl start coturn
```

Then set:
```bash
TURN_URLS=turn:peercall.yourdomain.com:3478
TURN_USERNAME=peercall
TURN_CREDENTIAL=your-secret
```

### Option 2: Hosted

- [Twilio TURN](https://www.twilio.com/docs/stun-turn) — Free tier available
- [Metered.ca TURN](https://www.metered.ca/tools/openrelay/) — Free for open source
- [Open Relay](https://openrelay.metered.ca/) — Free TURN servers

## Architecture

```
Client (React) ←→ Bun Server (SSR + WebSocket + Static)
                       ↓
                  Shared signaling protocol
```

- **Single port**: SSR, static assets, WebSocket signaling, and config API all on one port
- **No database**: Rooms are ephemeral, names stored in localStorage only
- **WebRTC mesh**: Direct P2P connections between browsers

## Tech Stack

- [TanStack Start](https://tanstack.com/start) — Fullstack React framework (SSR)
- [Bun](https://bun.sh) — Runtime + HTTP server
- [WebRTC](https://webrtc.org) — Peer-to-peer audio/video
- [MediaBunny](https://github.com/nicholasgasior/mediabunny) — Client-side MP4 recording
- [Vite](https://vitejs.dev) — Build tool

## License

MIT
