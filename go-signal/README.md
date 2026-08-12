# go-signal — Go port of the PeerCall signaling server

An experimental drop-in replacement for the Bun signaling server
(`signal/index.ts` + `signal/protocol.ts`). It speaks the exact same JSON
protocol over WebSocket at `/signal` and serves the same ICE config at
`/config`, so the React client works completely unchanged.

This does **not** replace `server.ts` (SSR/static prod server) — media,
WebRTC negotiation, and the UI all live in the browser regardless of the
server language, so a full Go rewrite would not change call quality or
reliability. This spike exists to evaluate ops/taste for the signaling layer
only.

## Run

```bash
cd go-signal
go build -o go-signal .
./go-signal            # listens on :8080 (or -port / $SIGNAL_PORT)
```

Then start the web client as usual (`bun run dev`) — Vite proxies `/signal`
and `/config` to `:8080`.

## Verify

The same Playwright verification suite used for the TypeScript server passes
against this one:

```bash
# from the repo root, with `bun run dev` running
SIGNAL_CMD=./go-signal/go-signal bun run scripts/demo/repro.ts go
```

## Env vars

Same as the Bun server: `SIGNAL_PORT`, `CORS_ORIGINS`, `TURN_URLS`,
`TURN_USERNAME`, `TURN_CREDENTIAL`. Without `TURN_*` it falls back to Open
Relay's free TURN servers.
