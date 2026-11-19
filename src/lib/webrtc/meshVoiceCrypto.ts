const encode = (data: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(data)));
const decode = (data: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(data), c => c.charCodeAt(0));

export class VoiceKeys {
  private pair: CryptoKeyPair | null = null;
  publicKey = '';
  private peers = new Map<string, { publicKey: string; key: CryptoKey }>();
  async init(): Promise<void> {
    this.pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    this.publicKey = encode(await crypto.subtle.exportKey('raw', this.pair.publicKey));
  }
  async accept(peer: string, publicKey: string): Promise<void> {
    if (!this.pair || this.peers.get(peer)?.publicKey === publicKey) return;
    const imported = await crypto.subtle.importKey('raw', decode(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: imported }, this.pair.privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    this.peers.set(peer, { publicKey, key });
  }
  async encrypt(peer: string, data: ArrayBuffer, aad: string): Promise<{ pcm: string; iv: string } | null> {
    const key = this.peers.get(peer)?.key;
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, data);
    return { pcm: encode(encrypted), iv: encode(iv.buffer) };
  }
  async decrypt(peer: string, pcm: string, iv: string, aad: string): Promise<ArrayBuffer | null> {
    const key = this.peers.get(peer)?.key;
    if (!key) return null;
    try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(aad) }, key, decode(pcm)); }
    catch { return null; }
  }
}