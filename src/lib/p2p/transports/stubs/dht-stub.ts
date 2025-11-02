/**
 * Stub for bittorrent-dht
 * Prevents build errors when experimental transports are not used
 */

export class Client {
  constructor() {
    console.warn('[DHT-Stub] BitTorrent DHT is not available in browser builds');
  }
  
  listen() {}
  destroy() {}
  on() {}
  addNode() {}
  lookup() {}
}

export default { Client };
