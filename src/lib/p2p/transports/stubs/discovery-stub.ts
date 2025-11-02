/**
 * Stub for torrent-discovery
 * Prevents build errors when experimental transports are not used
 */

import { EventEmitter } from 'events';

export default class Discovery extends EventEmitter {
  constructor() {
    super();
    console.warn('[Discovery-Stub] Torrent discovery is not available in browser builds');
  }
  
  updatePort() {}
  destroy() {}
}
