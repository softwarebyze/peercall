# PeerCall

Privacy-first peer-to-peer video calling. WebRTC mesh, local recording via MediaBunny. Media stays on the peer connection.

## Features

- **P2P Mesh** — Up to 8 participants connected directly via WebRTC. No SFU, no media relay.
- **Local Recording** — Record calls as MP4 on your device with MediaBunny.
- **No Accounts** — Names live in localStorage. No analytics. Media never hits our disk.
- **In-Call Chat** — Text is relayed through the signaling server and dies with the room.
- **Screen Sharing** — Share your screen with other participants.
- **Host Controls** — First participant becomes host. Host can end the call for everyone.

## Quick Start

### Development

```bash
bun install
bun run dev:all
```

This starts both the Vite dev server (port 3000) and the signaling server (port 8080).

Open http://localhost:3000

### Tests

```bash
bun test                 # unit tests (URL parse, devices, signaling)
bun run typecheck
```

### End-to-end (and the recording time capsule)

PeerCall's Playwright suite records **video of every test**. CI uploads those files as artifacts so you can watch how the product actually behaved at that commit.

```bash
bun run build
bunx playwright install chromium
bun run e2e
```

Recordings land in `e2e/recordings/<date>-<sha>/` (gitignored). On GitHub Actions, download the `peercall-e2e-<date>-<sha>` artifact (90-day retention).

The suite uses fake camera/mic devices. It does not need a real camera.

`bun run demo` is the optional reliability harness (`scripts/demo/repro.ts`): it kills the signaling server mid-call. It expects `bun run dev` on port 3000 and writes screenshots under `demo-artifacts/`. Prefer `bun run e2e` for product coverage.

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
| `METERED_DOMAIN` | (none) | Free Open Relay app host, e.g. `yourapp.metered.live` |
| `METERED_TURN_API_KEY` | (none) | Free Open Relay TURN API key ([docs](https://www.metered.ca/tools/openrelay/)) |
| `TURN_URLS` | (none) | Comma-separated TURN server URLs (alternative to Metered) |
| `TURN_USERNAME` | (none) | TURN username |
| `TURN_CREDENTIAL` | (none) | TURN credential |

## TURN Server

WebRTC P2P needs a TURN server for peers behind symmetric NATs or restrictive firewalls — without one, those calls hang on “Connecting…” or never show the other person.

Without TURN configured, PeerCall still serves public STUN servers (many home networks work). For reliable calls, set one of the free options below.

### Option 1: Free Metered Open Relay (recommended)

1. Sign up at [Open Relay / Metered](https://www.metered.ca/tools/openrelay/) (free, ~20 GB/month TURN).
2. Copy your app domain (`yourappname.metered.live`) and TURN API key from the dashboard.
3. Set secrets:

```bash
flyctl secrets set \
  METERED_DOMAIN=yourappname.metered.live \
  METERED_TURN_API_KEY=your_api_key
```

The server fetches short-lived ICE credentials from Metered’s REST API and exposes them on `/config` (the API key stays server-side).

### Option 2: Self-hosted (coturn)

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

### Option 3: Other hosted TURN

```bash
flyctl secrets set \
  TURN_URLS=turn:your-turn-server:3478 \
  TURN_USERNAME=user \
  TURN_CREDENTIAL=secret
```

- [Open Relay / Metered](https://www.metered.ca/tools/openrelay/) — Free tier (preferred path above)
- [Twilio TURN](https://www.twilio.com/docs/stun-turn) — Free tier available

## Architecture

```
Client (React) ←→ Bun Server (SSR + WebSocket + Static)
                       ↓
                  Shared signaling protocol
```

- **Single port**: SSR, static assets, WebSocket signaling, and config API all on one port
- **No database**: Rooms are ephemeral, names stored in localStorage only
- **WebRTC mesh**: Direct P2P connections between browsers (DTLS-SRTP on the media path)

## Tech Stack

- [TanStack Start](https://tanstack.com/start) — Fullstack React framework (SSR)
- [Bun](https://bun.sh) — Runtime + HTTP server
- [WebRTC](https://webrtc.org) — Peer-to-peer audio/video
- [MediaBunny](https://github.com/nicholasgasior/mediabunny) — Client-side MP4 recording
- [Vite](https://vitejs.dev) — Build tool

## License

MIT
