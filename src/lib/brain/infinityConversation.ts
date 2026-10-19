import type { NeuralStateEngine } from '../p2p/neuralStateEngine';
import { getEntityVoice } from '../p2p/entityVoice';

export const MAX_CONVERSATION_PROMPT = 1000;

/** Explicit private profile conversation; never ingest its text into peer digests. */
export function replyToInfinity(prompt: string, enabled: boolean, engine: NeuralStateEngine): string | null {
  const text = prompt.trim();
  if (!enabled || !text || text.length > MAX_CONVERSATION_PROMPT) return null;
  return getEntityVoice().generateText(text, engine);
}