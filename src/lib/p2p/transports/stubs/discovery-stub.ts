/**
 * Stub for torrent-discovery
 * Prevents build errors when experimental transports are not used
 */

export default class Discovery {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor() {
    console.warn('[Discovery-Stub] Torrent discovery is not available in browser builds');
  }
  on(_event: string, _cb: (...args: unknown[]) => void) { return this; }
  off(_event: string, _cb: (...args: unknown[]) => void) { return this; }
  emit(_event: string, ..._args: unknown[]) { return false; }
  updatePort() {}
  destroy() {}
}
