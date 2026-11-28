/**
 * Pass / waiting / problem checks for the /neural page, from the synapse
 * map's local counters and the learned dispatch weights.
 */
import { formatDistanceToNow } from "date-fns";
import type { SynapseMapStats } from "./synapseExchanger";
import { SYNAPSE_WEIGHT_FLOOR, getResistanceWeights } from "./synapticDispatch";

export type NeuralWeights = ReturnType<typeof getResistanceWeights>;
export type CheckState = "pass" | "wait" | "fail";
export interface NeuralCheck {
  label: string;
  state: CheckState;
  detail: string;
}

export const ago = (at: number | null): string =>
  at === null ? "never" : formatDistanceToNow(new Date(at), { addSuffix: true });

/** Pass / waiting / problem for each phase (pure — exported for tests). */
export function neuralChecks(stats: SynapseMapStats, weights: NeuralWeights): NeuralCheck[] {
  const sum = weights.latency + weights.failure + weights.load;
  const floored = [weights.latency, weights.failure, weights.load].every((w) => w >= SYNAPSE_WEIGHT_FLOOR - 1e-9);
  return [
    {
      label: "Exchanger running",
      state: stats.running ? "pass" : "fail",
      detail: stats.running
        ? "This tab is on the Global Cell and listening for synapse records."
        : "Not running. Networking is off in this tab, or the Global Cell has not started yet.",
    },
    {
      label: "Our record is shared",
      state: stats.shy ? "wait" : stats.unsigned ? "wait" : stats.published > 0 ? "pass" : "wait",
      detail: stats.shy
        ? "Shy mode is on, so this node only listens. That is expected."
        : stats.unsigned
          ? "Waiting for a signing key. Unlock your wallet or sign in again."
          : stats.published > 0
            ? `${stats.published} signed records sent, last ${ago(stats.lastPublishedAt)}.`
            : "No record sent yet. The first one goes out shortly after links open.",
    },
    {
      label: "Records arrive from others",
      state: stats.received > 0 ? "pass" : "wait",
      detail: stats.received > 0
        ? `${stats.received} received from ${stats.nodes} nodes, last ${ago(stats.lastReceivedAt)}.`
        : "Nothing heard yet. This needs at least one other node online on the Global Cell.",
    },
    {
      label: "Bad records are refused",
      state: stats.refused > stats.received ? "fail" : "pass",
      detail: stats.refused === 0
        ? "No records refused."
        : `${stats.refused} refused (bad signature, changed key, or stale). A few are normal; more refused than accepted points to a problem.`,
    },
    {
      label: "Map helps route picking",
      state: stats.assists > 0 ? "pass" : "wait",
      detail: stats.assists > 0
        ? `The network view helped choose a peer we had never met ${stats.assists} times.`
        : "Not used yet. It only steps in for peers this node has no first-hand memory of.",
    },
    {
      label: "Source weights are learning",
      state: !floored || Math.abs(sum - 1) > 1e-6 ? "fail" : weights.samples > 0 ? "pass" : "wait",
      detail: !floored || Math.abs(sum - 1) > 1e-6
        ? "Weights left their bounds. Clearing site data resets them."
        : weights.samples > 0
          ? `Tuned by ${weights.samples} manifest and chunk asks.`
          : "No asks yet. Open a post with media or a file from a peer to teach them.",
    },
  ];
}
