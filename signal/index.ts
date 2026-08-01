import { serve } from "bun";
import { handleMessage, handleClose } from "./protocol";

const PORT = Number(process.env.SIGNAL_PORT ?? 8080);
const ORIGIN_ALLOW = process.env.CORS_ORIGINS
  ? new Set(process.env.CORS_ORIGINS.split(",").map((s) => s.trim()))
  : new Set([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ]);

serve({
  port: PORT,
  fetch(req, server) {
    const origin = req.headers.get("origin") ?? "";
    if (origin && ![...ORIGIN_ALLOW].some((o) => origin.startsWith(o))) {
      return new Response("origin not allowed", { status: 403 });
    }
    const url = new URL(req.url);
    if (url.pathname === "/signal" || url.pathname === "/") {
      const ok = server.upgrade(req, { data: {} as any });
      if (ok) return;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("ok", { status: 200 });
  },
  websocket: {
    open() {},
    message: handleMessage,
    close: handleClose,
  },
});

console.log(`PeerCall signaling server on ws://localhost:${PORT}`);
