import { describe, expect, it } from 'vitest';
import { PEERJS_CLOUD_ENDPOINT, SignalingEndpointRotation, resolveSignalingEndpoints } from '../signalingEndpoints';

describe('signaling endpoints', () => {
  it('defaults to PeerJS Cloud alone', () => {
    expect(resolveSignalingEndpoints({})).toEqual([PEERJS_CLOUD_ENDPOINT]);
  });
  it('puts configured servers first and keeps PeerJS Cloud as the last resort', () => {
    const list = resolveSignalingEndpoints({
      VITE_PEERJS_ENDPOINTS: JSON.stringify([{ host: 'a.example.org' }, { host: 'bad host' }, { host: '0.peerjs.com', port: 443, path: '/' }]),
      VITE_PEERJS_HOST: 'b.example.org',
      VITE_PEERJS_PORT: '9000',
      VITE_PEERJS_SECURE: 'false',
      VITE_PEERJS_PATH: 'myapp',
    });
    expect(list.map(e => e.host)).toEqual(['a.example.org', '0.peerjs.com', 'b.example.org']);
    expect(list[2]).toMatchObject({ port: 9000, secure: false, path: '/myapp' });
  });
  it('ignores an unparseable endpoint list', () => {
    expect(resolveSignalingEndpoints({ VITE_PEERJS_ENDPOINTS: '{nope' })).toEqual([PEERJS_CLOUD_ENDPOINT]);
  });
  it('fails over after consecutive failures and wraps around', () => {
    const rotation = new SignalingEndpointRotation(resolveSignalingEndpoints({ VITE_PEERJS_HOST: 'self.example.org' }), 2);
    expect(rotation.current().host).toBe('self.example.org');
    expect(rotation.reportFailure()).toBe(false);
    expect(rotation.reportFailure()).toBe(true);
    expect(rotation.current().host).toBe('0.peerjs.com');
    rotation.reportFailure();
    rotation.reportSuccess();
    expect(rotation.reportFailure()).toBe(false);
    expect(rotation.reportFailure()).toBe(true);
    expect(rotation.current().host).toBe('self.example.org');
  });
  it('never rotates with a single endpoint', () => {
    const rotation = new SignalingEndpointRotation([PEERJS_CLOUD_ENDPOINT], 1);
    expect(rotation.reportFailure()).toBe(false);
    expect(rotation.current()).toBe(PEERJS_CLOUD_ENDPOINT);
  });
});
