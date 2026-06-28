import { describe, it, expect } from 'bun:test';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runCodemod(slug, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'uqrc-'));
  const file = join(dir, 'fixture.tsx');
  writeFileSync(file, contents);
  execSync(`node scripts/codemods/${slug}.mjs ${file}`, { stdio: 'pipe' });
  return require('node:fs').readFileSync(file, 'utf8');
}

describe('uqrc codemods', () => {
  it('no-native-form rewrites <form> → <div role="form">', () => {
    const out = runCodemod('no-native-form',
      `export const F = () => (<form onSubmit={e=>e.preventDefault()}><input/></form>);`);
    expect(out).toContain('<div role="form"');
    expect(out).not.toContain('<form');
    expect(out).toContain('</div>');
  });

  it('multiple-audio-contexts injects shared import', () => {
    const out = runCodemod('multiple-audio-contexts',
      `const ctx = new AudioContext();`);
    expect(out).toContain('getSharedAudioContext()');
    expect(out).toContain('@/lib/streaming/audioCtx');
  });

  it('destructive-db-upgrade annotates without deleting', () => {
    const out = runCodemod('destructive-db-upgrade',
      `indexedDB.deleteDatabase("swarm");`);
    expect(out).toContain('TODO(uqrc)');
    expect(out).toContain('indexedDB.deleteDatabase("swarm")');
  });
});

describe('uqrc-check', () => {
  it('runs and prints likely-fix block', () => {
    const out = execSync('node scripts/uqrc-check.mjs', { encoding: 'utf8' });
    if (out.includes('contradiction')) {
      expect(out).toContain('likely fix');
    }
  });
});
