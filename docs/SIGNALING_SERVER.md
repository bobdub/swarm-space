# Signaling Server Quickstart

A remote signaling server lets peers discover each other across devices. When the `VITE_SIGNALING_URL` environment variable is set, the client connects to the configured WebSocket endpoint and mirrors all signaling traffic through it in addition to the local `BroadcastChannel`.

## Minimal relay implementation

Any WebSocket relay that echoes JSON payloads to all connected clients works. The snippet below shows a minimal Bun-based server:

```ts
import { serve } from "bun";

const clients = new Set<WebSocket>();

const server = serve({
  fetch(req) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("Signaling server", { status: 200 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    message(ws, message) {
      for (const client of clients) {
        if (client !== ws) {
          client.send(message);
        }
      }
    }
  }
});

console.log(`Listening on ${server.hostname}:${server.port}`);
```

Start the relay and expose it via HTTPS/WSS (recommended for production). Then set the environment variable before running the app:

```bash
VITE_SIGNALING_URL="wss://example.com/signaling" npm run dev
```

With the relay configured, peers in different browsers or devices receive announcements, offers, answers, and ICE candidates without relying on shared browser state.
