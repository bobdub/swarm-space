import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

import {
  verifyPresenceTicket,
  type PresenceTicketEnvelope
} from '../../src/lib/p2p/presenceTicket';
import { canonicalJson } from '../../src/lib/utils/canonicalJson';
import {
  createCapsuleAlertService,
  type CapsuleAlertService,
  type CapsuleAlertPersistence,
  type CapsuleAlertState
} from '../../src/lib/alerts/capsuleAlerts';

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

async function main(alerts: CapsuleAlertService): Promise<void> {
  try {
    const config = loadConfig();
    if (config.beacons.length === 0) {
      throw new Error('No rendezvous beacons configured. Set RENDEZVOUS_BEACONS.');
    }
    if (!config.privateKey || !config.publicKey) {
      throw new Error('RENDEZVOUS_CAPSULE_PRIVATE_KEY and RENDEZVOUS_CAPSULE_PUBLIC_KEY must be set.');
    }

    const { tickets, stats } = await fetchTickets(config);
    if (tickets.length === 0) {
      throw new Error('[Capsule] No valid presence tickets discovered from configured beacons.');
    }

    const peers = tickets.slice(0, config.maxPeers);
    console.log(
      `[Capsule] Beacon summary: ${stats.beaconsContacted} contacted, ${stats.responsesWithPeers} with peers, ${stats.totalTickets} tickets fetched, ${stats.validTickets} valid, ${stats.invalidTickets} rejected.`
    );

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
    await alerts.recordSuccess({ peers: capsule.peers.length, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alerts.recordFailure(message);
    throw error;
  }
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

interface FetchStats {
  beaconsContacted: number;
  responsesWithPeers: number;
  totalTickets: number;
  validTickets: number;
  invalidTickets: number;
}

async function fetchTickets(config: CapsuleConfig): Promise<{ tickets: PresenceTicketEnvelope[]; stats: FetchStats }> {
  const dedupe = new Map<string, PresenceTicketEnvelope>();
  const stats: FetchStats = {
    beaconsContacted: config.beacons.length,
    responsesWithPeers: 0,
    totalTickets: 0,
    validTickets: 0,
    invalidTickets: 0
  };

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

        if (payload.peers.length === 0) {
          return;
        }

        stats.responsesWithPeers += 1;
        stats.totalTickets += payload.peers.length;

        for (const ticket of payload.peers) {
          const validation = await verifyPresenceTicket(ticket, {
            trustedPublicKeys: config.trustedTicketKeys
          });
          if (!validation.ok) {
            console.warn('[Capsule] Skipping invalid ticket:', validation.reason);
            stats.invalidTickets += 1;
            continue;
          }
          stats.validTickets += 1;
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

  return {
    tickets: Array.from(dedupe.values()).sort((a, b) => b.payload.expiresAt - a.payload.expiresAt),
    stats
  };
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

async function createAlertService(): Promise<CapsuleAlertService> {
  const statePath = resolve(process.cwd(), 'ops/capsules/.capsule-alerts.json');
  const persistence: CapsuleAlertPersistence = {
    async read() {
      try {
        const raw = await readFile(statePath, 'utf8');
        return JSON.parse(raw) as CapsuleAlertState;
      } catch (error) {
        return null;
      }
    },
    async write(state) {
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    }
  };

  const threshold = parseNumber(process.env.RENDEZVOUS_CAPSULE_ALERT_THRESHOLD, 3);
  return createCapsuleAlertService({
    threshold,
    persistence,
    notify(event) {
      const prefix = event.type === 'failure' ? '[Capsule Alerts] 🚨' : '[Capsule Alerts] ✅';
      const context = event.details ? ` ${JSON.stringify(event.details)}` : '';
      console.log(`${prefix} ${event.message} (streak=${event.streak})${context}`);
    }
  });
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  void (async () => {
    try {
      const alerts = await createAlertService();
      await main(alerts);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  })();
}
