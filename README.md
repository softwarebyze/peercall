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
