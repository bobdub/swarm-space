# P2P Signaling Setup Guide

## Overview

The Imagination Network uses WebRTC for peer-to-peer connections. By default, it operates in **Local Mode** where peers can only discover each other within the same browser (using BroadcastChannel).

For **cross-device discovery** (different browsers, devices, or networks), you need to deploy a signaling server.

---

## Architecture

```
┌─────────────┐         ┌─────────────┐
│  Browser A  │         │  Browser B  │
│   (Phone)   │         │  (Desktop)  │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │   WebSocket           │
       │   Signaling           │
       │                       │
       └───────┬───────────────┘
               │
        ┌──────▼──────┐
        │  Signaling  │
        │   Server    │
        │  (Relay)    │
        └─────────────┘
```

**Signaling Flow:**
1. Browser A connects to signaling server via WebSocket
2. Browser A announces presence with available content hashes
3. Signaling server relays announcement to Browser B
4. Browser B responds with WebRTC offer
5. Signaling server relays offer to Browser A
6. WebRTC connection established directly between A & B
7. Signaling server no longer needed (P2P data flows directly)

---

## Deployment Options

### Option 1: Supabase Edge Function (Recommended)

The project includes a pre-built signaling relay at `supabase/functions/p2p-signaling/`.

**Steps:**
1. The function is automatically deployed when you deploy to Lovable
2. Once deployed, get your function URL:
   ```
   wss://YOUR-PROJECT.supabase.co/functions/v1/p2p-signaling
   ```
3. Create a `.env` file in your project root:
   ```bash
   VITE_SIGNALING_URL=wss://YOUR-PROJECT.supabase.co/functions/v1/p2p-signaling
   ```
4. Restart your dev server
5. Open the app on different devices - they'll discover each other!

**Benefits:**
- ✅ No external services needed
- ✅ Automatically deployed with your app
- ✅ Secure WSS by default
- ✅ Scales automatically

---

### Option 2: Self-Hosted Bun Server

Deploy the minimal relay from `docs/SIGNALING_SERVER.md`:

```typescript
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

**Deploy to:**
- Railway
- Fly.io
- DigitalOcean
- Your own VPS

Then set `VITE_SIGNALING_URL=wss://your-server.com/signaling`

---

## Testing P2P Discovery

### Local Mode (Default)
1. Enable P2P in the app (click the wifi icon)
2. Open the app in **multiple tabs** in the same browser
3. Check P2P status indicator - you should see:
   - Discovered Peers: 2+
   - Connected Peers: 2+

### Remote Mode (Cross-Device)
1. Set `VITE_SIGNALING_URL` in `.env`
2. Deploy your app
3. Open app on your phone
4. Open app on your desktop
5. Enable P2P on both devices
6. Check P2P status - devices should discover each other!

---

## Troubleshooting

### "Discovered Peers: 0" in Local Mode
- Make sure you've opened multiple **tabs** (not windows) in the same browser
- Enable P2P in each tab
- Check browser console for errors

### "Discovered Peers: 0" in Remote Mode
- Verify `VITE_SIGNALING_URL` is set correctly
- Check signaling server is running (visit URL in browser)
- Ensure both devices have P2P enabled
- Check browser console for WebSocket connection errors

### WebRTC Connection Fails
- Check browser console for ICE candidate errors
- May need TURN server for restrictive NATs (not implemented yet)
- Try on same WiFi network first

### Browser Compatibility
- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support  
- Safari: ✅ Should work (needs testing)
- Mobile browsers: ✅ Should work (needs testing)

---

## Security Notes

The signaling server is **public and unauthenticated** by design:
- It only relays connection setup messages (offers, answers, ICE candidates)
- All actual data flows P2P over encrypted WebRTC channels
- File chunks are already encrypted before P2P transfer
- Peer identity is verified via user public keys

---

## Next Steps

- [ ] Deploy signaling server
- [ ] Test cross-device discovery
- [ ] Add TURN fallback for NAT traversal
- [ ] Implement bandwidth limits
- [ ] Add connection quality metrics
