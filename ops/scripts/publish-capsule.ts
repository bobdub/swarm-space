import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

import {
  verifyPresenceTicket,
  type PresenceTicketEnvelope
} from '../../src/lib/p2p/presenceTicket';
import { canonicalJson } from '../../src/lib/utils/canonicalJson';

interface CapsuleConfig {
  beacons: string[];
  community: string;
  outputDir: string;
  ttlMs: number;
  privateKey: string;
  publicKey: string;
  trustedTicketKeys?: string[];
  maxPeers: number;
}

interface CapsuleFile {
  version: number;
  community: string;
  issuedAt: number;
  expiresAt: number;
  peers: PresenceTicketEnvelope[];
  signature: string;
  algorithm: 'ed25519';
}

const DEFAULTS = {
  ttlMs: 5 * 60_000,
  maxPeers: 100,
  community: 'mainnet',
  outputDir: './public/capsules'
};

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.beacons.length === 0) {
    throw new Error('No rendezvous beacons configured. Set RENDEZVOUS_BEACONS.');
  }
  if (!config.privateKey || !config.publicKey) {
    throw new Error('RENDEZVOUS_CAPSULE_PRIVATE_KEY and RENDEZVOUS_CAPSULE_PUBLIC_KEY must be set.');
  }

  const tickets = await fetchTickets(config);
  const peers = tickets.slice(0, config.maxPeers);

  const now = Date.now();
  const capsulePayload = {
    version: 1,
    community: config.community,
    issuedAt: now,
    expiresAt: now + config.ttlMs,
    peers
  } satisfies Omit<CapsuleFile, 'signature' | 'algorithm'>;

  const canonicalPayload = canonicalJson(capsulePayload);
  const signature = await signPayload(canonicalPayload, config.privateKey);

  const capsule: CapsuleFile = {
    ...capsulePayload,
    signature,
    algorithm: 'ed25519'
  };

  await writeCapsuleFiles(capsule, config.outputDir, config.publicKey);
  console.log(`Wrote capsule with ${capsule.peers.length} peers to ${config.outputDir}`);
}

function loadConfig(): CapsuleConfig {
  const beacons = parseList(process.env.RENDEZVOUS_BEACONS);
  const trustedTicketKeys = parseList(process.env.RENDEZVOUS_TRUSTED_TICKET_KEYS);

  return {
    beacons,
    community: process.env.RENDEZVOUS_COMMUNITY ?? DEFAULTS.community,
    outputDir: process.env.RENDEZVOUS_CAPSULE_OUTPUT ?? DEFAULTS.outputDir,
    ttlMs: parseNumber(process.env.RENDEZVOUS_CAPSULE_TTL_MS, DEFAULTS.ttlMs),
    privateKey: process.env.RENDEZVOUS_CAPSULE_PRIVATE_KEY ?? '',
    publicKey: process.env.RENDEZVOUS_CAPSULE_PUBLIC_KEY ?? '',
    trustedTicketKeys: trustedTicketKeys.length > 0 ? trustedTicketKeys : undefined,
    maxPeers: parseNumber(process.env.RENDEZVOUS_CAPSULE_MAX_PEERS, DEFAULTS.maxPeers)
  };
}

async function fetchTickets(config: CapsuleConfig): Promise<PresenceTicketEnvelope[]> {
  const dedupe = new Map<string, PresenceTicketEnvelope>();

  await Promise.all(
    config.beacons.map(async (baseUrl) => {
      const url = new URL(baseUrl.replace(/\/$/, '') + '/peers');
      url.searchParams.set('community', config.community);

      try {
        const response = await fetch(url.toString());
        if (!response.ok) {
          console.warn(`[Capsule] Beacon request failed (${response.status}): ${url}`);
          return;
        }
        const payload = (await response.json()) as { peers?: PresenceTicketEnvelope[] };
        if (!payload.peers || !Array.isArray(payload.peers)) {
          console.warn('[Capsule] Beacon response missing peers array:', payload);
          return;
        }

        for (const ticket of payload.peers) {
          const validation = await verifyPresenceTicket(ticket, {
            trustedPublicKeys: config.trustedTicketKeys
          });
          if (!validation.ok) {
            console.warn('[Capsule] Skipping invalid ticket:', validation.reason);
            continue;
          }
          const key = `${ticket.payload.peerId}:${ticket.payload.userId}`;
          const existing = dedupe.get(key);
          if (!existing || existing.payload.expiresAt < ticket.payload.expiresAt) {
            dedupe.set(key, ticket);
          }
        }
      } catch (error) {
        console.error('[Capsule] Failed to fetch beacon:', error);
      }
    })
  );

  return Array.from(dedupe.values()).sort((a, b) => b.payload.expiresAt - a.payload.expiresAt);
}

async function signPayload(payload: string, privateKeyB64: string): Promise<string> {
  const keyData = Buffer.from(privateKeyB64, 'base64');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('Ed25519', key, encoder.encode(payload));
  return Buffer.from(signature).toString('base64');
}

async function writeCapsuleFiles(capsule: CapsuleFile, outputDir: string, publicKey: string): Promise<void> {
  const resolved = resolve(process.cwd(), outputDir);
  await mkdir(resolved, { recursive: true });

  const capsulePath = resolve(resolved, 'peers.json');
  const signaturePath = resolve(resolved, 'peers.json.sig');
  const manifestPath = resolve(resolved, 'peers.json.manifest');

  await writeFile(capsulePath, JSON.stringify(capsule, null, 2));
  await writeFile(signaturePath, capsule.signature, 'utf8');
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        algorithm: 'ed25519',
        publicKey
      },
      null,
      2
    ),
    'utf8'
  );
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
