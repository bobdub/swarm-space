/**
 * Guardrails event bus — tiny pub/sub used to broadcast Browser QScore
 * transitions and chain progress. Kept independent of the UQRC field so
 * the guardrails layer stays observable without pulling heavy deps.
 */

export type GuardrailsLevel = 'healthy' | 'warn' | 'degrade' | 'critical';

export type GuardrailsEvent =
  | { type: 'qscore'; score: number; level: GuardrailsLevel; at: number }
  | { type: 'chain-step'; id: string; state: 'starting' | 'done' | 'error'; at: number; error?: string }
  | { type: 'chain-paused'; reason: string; at: number }
  | { type: 'chain-resumed'; at: number };

const listeners = new Set<(e: GuardrailsEvent) => void>();

export function emitGuardrails(evt: GuardrailsEvent): void {
  for (const fn of listeners) {
    try { fn(evt); } catch { /* ignore */ }
  }
}

export function subscribeGuardrails(fn: (e: GuardrailsEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}