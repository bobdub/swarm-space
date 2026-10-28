/// <reference lib="webworker" />
import engineUrl from "./engine/lyra2v2.wasm?url";
import { createHashEngine } from "./hashEngine";
import { MintMeHashLoop } from "./hashLoop";
import type { StratumJob } from "./stratum";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let loop: MintMeHashLoop | null = null;
let initializing = false;
let stopped = false;
ctx.onmessage = async (e: MessageEvent<{ type: string; job?: StratumJob; generation?: number }>) => {
  if (e.data.type === "stop") { stopped = true; loop?.stop(); return; }
  if (e.data.type === "init" && !initializing) {
    initializing = true;
    try {
      const response = await fetch(engineUrl);
      if (!response.ok) throw new Error("Engine unavailable");
      const engine = await createHashEngine(await response.arrayBuffer());
      if (stopped) return;
      loop = new MintMeHashLoop(engine.hash, message => ctx.postMessage(message));
      ctx.postMessage({ type: "ready" });
    } catch { if (!stopped) ctx.postMessage({ type: "unavailable" }); }
  } else if (!stopped && e.data.type === "start") loop?.start();
  else if (!stopped && e.data.type === "job" && e.data.job) loop?.setJob(e.data.job, e.data.generation ?? 0);
};
