declare module 'webtorrent' {
  interface WebTorrentWire {
    peerId?: string;
    on(event: 'data' | 'close' | 'download' | 'upload', handler: (...args: unknown[]) => void): void;
    on(event: 'extended', handler: (extension: string, payload: Uint8Array) => void): void;
    extended(extension: string, payload: Uint8Array | Record<string, unknown>): void;
    destroy(): void;
  }

  interface WebTorrentTorrent {
    infoHash: string;
    wires: WebTorrentWire[];
    on(event: 'wire', handler: (wire: WebTorrentWire) => void): void;
    destroy(cb?: (error?: Error | null) => void): void;
  }

  export default class WebTorrent {
    constructor(options?: Record<string, unknown>);
    add(
      magnetURI: string,
      options: Record<string, unknown>,
      callback?: (torrent: WebTorrentTorrent) => void,
    ): WebTorrentTorrent;
    destroy(callback?: (error?: Error | null) => void): void;
  }
}

declare module 'gun' {
  export interface GunAck {
    err?: string;
  }

  export interface GunChain {
    get(key: string): GunChain;
    put(data: unknown, callback?: (ack: GunAck) => void): GunChain;
    on(handler: (data: unknown, key: string) => void): GunChain;
    once(handler: (data: unknown, key: string) => void): GunChain;
    off(): GunChain;
  }

  export interface GunOptions {
    peers?: string[];
    radisk?: boolean;
    localStorage?: boolean;
  }

  export interface GunInstance extends GunChain {
    opt(options: GunOptions): GunInstance;
    close(): void;
  }

  type GunConstructor = (options?: GunOptions) => GunInstance;

  const Gun: GunConstructor & { Gun: GunConstructor };
  export default Gun;
}
