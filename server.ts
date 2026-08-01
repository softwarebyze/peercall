// Unified production server: SSR + WebSocket signaling on a single port.
// Usage: bun run build && PORT=3000 bun run server.ts
//
// Environment variables:
//   PORT             – HTTP/WS port (default 3000)
//   CORS_ORIGINS     – comma-separated allowed origins (default: allow all)
//   TURN_URLS        – comma-separated TURN server URLs
//   TURN_USERNAME    – TURN username
//   TURN_CREDENTIAL  – TURN credential

import { serve } from "bun";
import { handleMessage, handleClose } from "./signal/protocol";

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? new Set(process.env.CORS_ORIGINS.split(",").map((s) => s.trim()))
  : null;

// ─── TanStack Start SSR handler ───────────────────────────────────────────────
const ssrApp = (await import("./dist/server/server.js")).default;

// ─── Start server ─────────────────────────────────────────────────────────────
const server = serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Health check (for Docker / load balancers)
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", uptime: process.uptime() });
    }

    // CORS check
    const origin = req.headers.get("origin") ?? "";
    if (origin && CORS_ORIGINS && ![...CORS_ORIGINS].some((o) => origin.startsWith(o))) {
      return new Response("origin not allowed", { status: 403 });
    }

    // WebSocket upgrade for /signal
    if (url.pathname === "/signal") {
      const ok = server.upgrade(req, { data: {} as any });
      if (ok) return;
      return new Response("upgrade failed", { status: 400 });
    }

    // TURN config endpoint (credentials stay server-side)
    if (url.pathname === "/config") {
      const turnUrls = process.env.TURN_URLS?.split(",").map((s) => s.trim()) ?? [];
      const turnConfig: RTCConfiguration = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
        ],
      };
      if (turnUrls.length > 0) {
        turnConfig.iceServers!.push({
          urls: turnUrls,
          username: process.env.TURN_USERNAME ?? "",
          credential: process.env.TURN_CREDENTIAL ?? "",
        });
      }
      return Response.json(turnConfig);
    }

    // Serve static assets from dist/client/ (hash-based filenames → immutable)
    if (url.pathname.startsWith("/assets/")) {
      const file = Bun.file(`./dist/client${url.pathname}`);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-type": file.type,
          },
        });
      }
    }

    // Everything else → TanStack Start SSR
    try {
      return await ssrApp.fetch(req);
    } catch (err) {
      console.error("SSR error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  websocket: {
    open() {},
    message: handleMessage,
    close: handleClose,
  },
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  server.stop(true);
});
process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  server.stop(true);
});

console.log(`PeerCall production server on http://localhost:${PORT}`);
console.log(`  WebSocket signaling on /signal`);
console.log(`  SSR via TanStack Start`);
if (CORS_ORIGINS) console.log(`  CORS origins: ${[...CORS_ORIGINS].join(", ")}`);
