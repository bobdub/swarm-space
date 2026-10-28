import { fromHex, meetsTarget, toHex, writeNonce } from "./hashEngine";
import type { StratumJob } from "./stratum";
type Output = { type: "hashes"; count: number } | { type: "share"; jobId: string; generation: number; nonce: string; result: string };
/** One real hash per slice; rest 3× its duration (~25% single-core duty). */
export class MintMeHashLoop {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private work: { job: StratumJob; blob: Uint8Array; nonce: bigint; generation: number } | null = null;
  constructor(private hash: (blob: Uint8Array) => Uint8Array, private emit: (message: Output) => void) {}
  setJob(job: StratumJob, generation: number): void {
    this.work = { job, generation, blob: fromHex(job.blob), nonce: BigInt(`0x${toHex(crypto.getRandomValues(new Uint8Array(8)))}`) };
    if (this.running && this.timer === null) this.schedule(0);
  }
  start(): void { this.running = true; if (this.work && this.timer === null) this.schedule(0); }
  stop(): void { this.running = false; this.work = null; if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule(delay: number): void { this.timer = setTimeout(() => this.step(), delay); }
  private step(): void {
    this.timer = null;
    const work = this.work;
    if (!this.running || !work) return;
    const started = performance.now();
    const nonce = writeNonce(work.blob, work.nonce);
    const result = this.hash(work.blob);
    if (this.work !== work || !this.running) return;
    this.emit({ type: "hashes", count: 1 });
    if (meetsTarget(result, work.job.target)) this.emit({ type: "share", jobId: work.job.jobId, generation: work.generation, nonce, result: toHex(result) });
    if (work.nonce === 0xffffffffffffffffn) { this.work = null; return; }
    work.nonce += 1n;
    this.schedule(Math.max(10, (performance.now() - started) * 3));
  }
}