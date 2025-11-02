import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { WebTorrentAdapter } from '@/lib/p2p/transports/webtorrentAdapter';
import { GunAdapter } from '@/lib/p2p/transports/gunAdapter';

type Scenario = 'webtorrent' | 'gun';

interface CliOptions {
  scenario: Scenario;
  peers: number;
  duration: number;
}

interface BenchmarkResult {
  scenario: Scenario;
  timestamp: string;
  peers: number;
  fallbackAttempts: number;
  fallbackSuccess: number;
  fallbackTimeouts: number;
  p95FallbackLatencyMs: number;
  transport: Scenario;
  samples: number[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        options[key] = value;
        i += 1;
      } else {
        options[key] = 'true';
      }
    }
  }

  const scenario = (options.scenario ?? 'webtorrent') as Scenario;
  if (!['webtorrent', 'gun'].includes(scenario)) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  const peers = Math.max(1, Number.parseInt(options.peers ?? '4', 10) || 4);
  const duration = Math.max(1, Number.parseInt(options.duration ?? '30', 10) || 30);

  return { scenario, peers, duration };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function runWebTorrentBenchmark(peers: number, attempts: number): Promise<number[]> {
  const channel = `bench-webtorrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adapterA = new WebTorrentAdapter({ swarmId: channel, channelName: channel });
  const adapterB = new WebTorrentAdapter({ swarmId: channel, channelName: channel });

  await adapterA.start({ peerId: 'peer-a' });
  await adapterB.start({ peerId: 'peer-b' });

  const startTimes = new Map<string, number>();
  const waiters = new Map<string, (value: number) => void>();
  const latencies: number[] = [];

  const unsubscribe = adapterB.onMessage('chunk', (_peerId, payload) => {
    const envelope = payload as { requestId?: string };
    const requestId = envelope?.requestId;
    if (!requestId) {
      return;
    }
    const started = startTimes.get(requestId);
    if (typeof started !== 'number') {
      return;
    }
    const latency = performance.now() - started;
    latencies.push(latency);
    startTimes.delete(requestId);
    const resolve = waiters.get(requestId);
    if (resolve) {
      waiters.delete(requestId);
      resolve(latency);
    }
  });

  const timeoutMs = 2_000;
  const totalIterations = Math.max(attempts, peers);

  for (let i = 0; i < totalIterations; i += 1) {
    const requestId = `req-${i}-${Math.random().toString(36).slice(2)}`;
    startTimes.set(requestId, performance.now());
    const latency = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(requestId);
        startTimes.delete(requestId);
        resolve(Number.NaN);
      }, timeoutMs);
      waiters.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      adapterA.send('chunk', 'peer-b', {
        type: 'request_chunk',
        requestId,
        hash: `hash-${requestId}`,
      });
    });
    if (!Number.isFinite(latency)) {
      // record a timeout marker; downstream consumer counts successes separately
    }
  }

  unsubscribe();
  adapterA.stop();
  adapterB.stop();

  return latencies;
}

async function runGunBenchmark(peers: number, attempts: number): Promise<number[]> {
  const channel = `bench-gun-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adapterA = new GunAdapter({ channelName: channel, graphKey: `${channel}/graph` });
  const adapterB = new GunAdapter({ channelName: channel, graphKey: `${channel}/graph` });

  await adapterA.start({ peerId: 'peer-a' });
  await adapterB.start({ peerId: 'peer-b' });

  const startTimes = new Map<string, number>();
  const waiters = new Map<string, (value: number) => void>();
  const latencies: number[] = [];

  const unsubscribe = adapterB.onMessage('chunk', (_peerId, payload) => {
    const envelope = payload as { requestId?: string };
    const requestId = envelope?.requestId;
    if (!requestId) {
      return;
    }
    const started = startTimes.get(requestId);
    if (typeof started !== 'number') {
      return;
    }
    const latency = performance.now() - started;
    latencies.push(latency);
    startTimes.delete(requestId);
    const resolve = waiters.get(requestId);
    if (resolve) {
      waiters.delete(requestId);
      resolve(latency);
    }
  });

  const timeoutMs = 3_000;
  const totalIterations = Math.max(attempts, peers);

  for (let i = 0; i < totalIterations; i += 1) {
    const requestId = `req-${i}-${Math.random().toString(36).slice(2)}`;
    startTimes.set(requestId, performance.now());
    const latency = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(requestId);
        startTimes.delete(requestId);
        resolve(Number.NaN);
      }, timeoutMs);
      waiters.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      adapterA.send('chunk', 'peer-b', {
        type: 'request_chunk',
        requestId,
        hash: `hash-${requestId}`,
      });
    });
    if (!Number.isFinite(latency)) {
      // timeout recorded implicitly
    }
  }

  unsubscribe();
  adapterA.stop();
  adapterB.stop();

  return latencies;
}

async function runBenchmark(options: CliOptions): Promise<BenchmarkResult> {
  const { scenario, peers, duration } = options;
  const attempts = Math.max(5, Math.round((duration / 5) * peers));

  const latencies = scenario === 'webtorrent'
    ? await runWebTorrentBenchmark(peers, attempts)
    : await runGunBenchmark(peers, attempts);

  const fallbackSuccess = latencies.length;
  const fallbackTimeouts = attempts - fallbackSuccess;
  return {
    scenario,
    timestamp: new Date().toISOString(),
    peers,
    fallbackAttempts: attempts,
    fallbackSuccess,
    fallbackTimeouts,
    p95FallbackLatencyMs: Number.isFinite(percentile(latencies, 95)) ? Math.round(percentile(latencies, 95)) : 0,
    transport: scenario,
    samples: latencies.map((value) => Number(value.toFixed(2))),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBenchmark(args);

  const resultsDir = join(process.cwd(), 'ops/benchmarks/p2p/results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const filename = `${args.scenario}-${Date.now()}.json`;
  const outputPath = join(resultsDir, filename);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`Benchmark complete. Report written to ${outputPath}`);
}

void main().catch((error) => {
  console.error('[benchmarks] Failed to execute benchmark', error);
  process.exitCode = 1;
});
