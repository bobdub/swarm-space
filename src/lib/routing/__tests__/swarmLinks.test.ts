import { describe, expect, it } from 'vitest';
import { isExternalWebLink, resolveSwarmPath } from '../swarmLinks';

const ORIGIN = 'http://localhost:3000';

describe('resolveSwarmPath', () => {
  it('keeps relative app paths in-app', () => {
    expect(resolveSwarmPath('/posts/abc', ORIGIN)).toBe('/posts/abc');
    expect(resolveSwarmPath('/u/alice?tab=posts#posts-feed', ORIGIN)).toBe('/u/alice?tab=posts#posts-feed');
  });

  it('maps same-origin and known SWARM hosts to in-app paths', () => {
    expect(resolveSwarmPath(`${ORIGIN}/posts/abc`, ORIGIN)).toBe('/posts/abc');
    expect(resolveSwarmPath('https://swarm-space.lovable.app/u/bob', ORIGIN)).toBe('/u/bob');
    expect(resolveSwarmPath('https://swarm-space.network/projects/p1/hub', ORIGIN)).toBe('/projects/p1/hub');
  });

  it('rejects external, non-http, file and same-page links', () => {
    expect(resolveSwarmPath('https://github.com/bobdub/swarm-space', ORIGIN)).toBeNull();
    expect(resolveSwarmPath('https://rpc.swarm-space.lovable.app/x', ORIGIN)).toBeNull();
    expect(resolveSwarmPath('mailto:a@b.c', ORIGIN)).toBeNull();
    expect(resolveSwarmPath('/whitepaper.pdf', ORIGIN)).toBeNull();
    expect(resolveSwarmPath('#section', ORIGIN)).toBeNull();
    expect(resolveSwarmPath('', ORIGIN)).toBeNull();
  });
});

describe('isExternalWebLink', () => {
  it('flags only http(s) links that leave the app', () => {
    expect(isExternalWebLink('https://example.com', ORIGIN)).toBe(true);
    expect(isExternalWebLink('/posts/abc', ORIGIN)).toBe(false);
    expect(isExternalWebLink('https://swarm-space.lovable.app/posts/1', ORIGIN)).toBe(false);
    expect(isExternalWebLink('mailto:a@b.c', ORIGIN)).toBe(false);
  });
});
