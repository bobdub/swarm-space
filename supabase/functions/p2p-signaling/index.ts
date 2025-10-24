/**
 * WebSocket Signaling Relay for P2P Discovery
 * 
 * This edge function acts as a simple WebSocket relay that echoes
 * signaling messages between peers for WebRTC connection establishment.
 * 
 * No database or authentication - pure message relay for P2P networking.
 */

const connectedClients = new Set<WebSocket>();

Deno.serve((req) => {
  console.log('[Signaling] Incoming connection request');
  
  // Check if this is a WebSocket upgrade request
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    console.log('[Signaling] Non-WebSocket request received');
    return new Response("WebSocket signaling relay - Connect via ws://", { 
      status: 200,
      headers: { "content-type": "text/plain" }
    });
  }

  // Upgrade to WebSocket
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  socket.addEventListener("open", () => {
    connectedClients.add(socket);
    console.log(`[Signaling] Client connected. Total clients: ${connectedClients.size}`);
  });

  socket.addEventListener("message", (event) => {
    try {
      // Parse and log the signaling message type for debugging
      const message = JSON.parse(event.data);
      console.log(`[Signaling] Relaying ${message.type} from ${message.from}${message.to ? ` to ${message.to}` : ' (broadcast)'}`);
      
      // Relay message to all other connected clients
      let relayCount = 0;
      for (const client of connectedClients) {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
          client.send(event.data);
          relayCount++;
        }
      }
      
      console.log(`[Signaling] Message relayed to ${relayCount} peer(s)`);
    } catch (error) {
      console.error('[Signaling] Error relaying message:', error);
    }
  });

  socket.addEventListener("close", () => {
    connectedClients.delete(socket);
    console.log(`[Signaling] Client disconnected. Total clients: ${connectedClients.size}`);
  });

  socket.addEventListener("error", (event) => {
    console.error('[Signaling] WebSocket error:', event);
    connectedClients.delete(socket);
  });

  return response;
});
