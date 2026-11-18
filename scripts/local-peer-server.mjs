#!/usr/bin/env node
/**
 * Local PeerServer for development and CI, so local meshes and two-peer
 * checks stop depending on the throttled shared 0.peerjs.com.
 *
 *   bun run peer:server               PeerServer only (ws://127.0.0.1:9000/)
 *   bun run dev:mesh                  PeerServer + Vite, wired via VITE_PEERJS_*
 *   bun run peer:smoke                Start PeerServer, relay a message between two peers, exit 0/1
 *   bun run peer:with -- <command>    Run <command> with a PeerServer up and VITE_PEERJS_* exported
 *
 * Env overrides: PEERJS_LOCAL_PORT (9000), PEERJS_LOCAL_BIND (127.0.0.1; use
 * 0.0.0.0 to reach it from other devices on your LAN), PEERJS_LOCAL_HOST (the
 * hostname browsers dial, defaults to the bind address or 127.0.0.1).
 *
 * The server package (`peer`) is fetched on demand with bunx (or npx when Bun
 * is missing) at a pinned version, so it adds nothing to the app's lockfiles.
 * Production builds are untouched: without VITE_PEERJS_* the app keeps using
 * PeerJS Cloud.
 */
import { spawn, spawnSync } from 'node:child_process';

const PEER_PACKAGE = 'peer@1.0.2';
const port = Number(process.env.PEERJS_LOCAL_PORT || 9000);
const bind = process.env.PEERJS_LOCAL_BIND || '127.0.0.1';
const dialHost = process.env.PEERJS_LOCAL_HOST || (bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind);
const path = '/';
const key = 'peerjs';
const baseUrl = `http://${dialHost}:${port}`;

const children = new Set();

function hasBun() {
  return spawnSync('bun', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

function launch(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

function peerEnv() {
  return {
    VITE_PEERJS_HOST: dialHost,
    VITE_PEERJS_PORT: String(port),
    VITE_PEERJS_SECURE: 'false',
    VITE_PEERJS_PATH: path,
    VITE_PEERJS_LABEL: 'Local PeerServer',
  };
}

function startPeerServer() {
  const serverArgs = ['peerjs', '--port', String(port), '--host', bind, '--path', path, '--key', key];
  const child = hasBun()
    ? launch('bunx', ['-p', PEER_PACKAGE, ...serverArgs])
    : launch('npx', ['-y', '-p', PEER_PACKAGE, ...serverArgs]);
  child.on('exit', (code) => {
    console.error(`[peer] PeerServer exited (${code ?? 'signal'})`);
    shutdown(code || 1);
  });
  return child;
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}${path}`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`PeerServer did not answer at ${baseUrl}${path} within ${timeoutMs / 1000}s`);
}

/** Registers two peers over the signaling socket and relays an OFFER from A to B. */
async function smoke() {
  const wsUrl = (id) => `ws://${dialHost}:${port}${path}peerjs?key=${key}&id=${id}&token=${Math.random().toString(36).slice(2)}`;
  const suffix = Date.now().toString(36);
  const idA = `smoke-a-${suffix}`;
  const idB = `smoke-b-${suffix}`;

  // Node < 22 has no global WebSocket; fall back to the `ws` package.
  let WebSocketImpl = globalThis.WebSocket;
  if (!WebSocketImpl) {
    try {
      WebSocketImpl = (await import('ws')).WebSocket;
    } catch {
      throw new Error('No WebSocket available: use Node 22+ or Bun, or install dependencies so the `ws` package is present.');
    }
  }

  const open = (id) => new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl(id));
    const timer = setTimeout(() => reject(new Error(`${id}: no OPEN from server`)), 10_000);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'OPEN') { clearTimeout(timer); resolve(ws); }
      if (msg.type === 'ERROR' || msg.type === 'ID-TAKEN') { clearTimeout(timer); reject(new Error(`${id}: ${msg.type}`)); }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${id}: socket error`)); });
  });

  const [a, b] = await Promise.all([open(idA), open(idB)]);
  const relayed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OFFER was not relayed from A to B')), 10_000);
    b.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'OFFER' && msg.src === idA) { clearTimeout(timer); resolve(msg); }
    });
  });
  a.send(JSON.stringify({ type: 'OFFER', dst: idB, payload: { smoke: true } }));
  await relayed;
  a.close();
  b.close();
  console.log(`[peer] ✅ Two-peer signaling relay OK on ${baseUrl}${path}`);
}

async function main() {
  const [mode = 'serve', ...rest] = process.argv.slice(2);
  const passthrough = rest[0] === '--' ? rest.slice(1) : rest;

  if (!['serve', 'dev', 'smoke', 'run'].includes(mode)) {
    console.error(`Unknown mode "${mode}". Use serve | dev | smoke | run -- <command>.`);
    process.exit(2);
  }
  if (mode === 'run' && passthrough.length === 0) {
    console.error('run needs a command, e.g. bun run peer:with -- bun run test');
    process.exit(2);
  }

  startPeerServer();
  await waitForServer();
  console.log(`[peer] PeerServer ready at ws://${dialHost}:${port}${path} (key "${key}")`);

  const env = { ...process.env, ...peerEnv() };

  if (mode === 'serve') return; // keep running until Ctrl+C
  if (mode === 'smoke') {
    await smoke();
    shutdown(0);
  }
  if (mode === 'dev') {
    const vite = hasBun()
      ? launch('bun', ['run', 'dev', ...passthrough], { env })
      : launch('npm', ['run', 'dev', '--', ...passthrough], { env });
    vite.on('exit', (code) => shutdown(code ?? 0));
  }
  if (mode === 'run') {
    const [cmd, ...args] = passthrough;
    const child = launch(cmd, args, { env });
    child.on('exit', (code) => shutdown(code ?? 1));
  }
}

main().catch((error) => {
  console.error(`[peer] ${error.message}`);
  shutdown(1);
});
