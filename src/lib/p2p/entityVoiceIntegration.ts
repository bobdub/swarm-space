/**
 * Entity Voice Integration — listens for post events and triggers
 * the network entity's voice module to potentially comment.
 *
 * This module bridges the standalone swarm mesh (which cannot import
 * project modules) with the EntityVoice + NeuralStateEngine.
 */

import { getEntityVoice, ENTITY_USER_ID } from './entityVoice';
import { NeuralStateEngine } from './neuralStateEngine';
import type { Post } from '@/types';

let _engine: NeuralStateEngine | null = null;
let _listening = false;

/**
 * Initialize the entity voice listener with a NeuralStateEngine instance.
 * Call once when the app boots (e.g., from P2PContext or a top-level effect).
 */
export function initEntityVoiceListener(engine: NeuralStateEngine): void {
  _engine = engine;

  if (_listening) return;
  _listening = true;

  window.addEventListener('p2p-entity-voice-evaluate', async (e: Event) => {
    const postData = (e as CustomEvent).detail as Record<string, unknown>;
    if (!postData || !postData.id) return;
    await evaluateAndComment(postData as unknown as Post);
  });

  console.log('[EntityVoice] 🧠 Listener initialized');
}

async function evaluateAndComment(post: Post): Promise<void> {
  if (!_engine) return;

  const voice = getEntityVoice();

  // Don't comment on our own comments' parent posts if already commented
  if (post.author === ENTITY_USER_ID) return;

  if (!voice.shouldComment(post, _engine)) return;

  const comment = voice.generateComment(post, _engine);
  if (!comment) return;

  console.log(`[EntityVoice] 🧠 Stage ${voice.computeBrainStage(
    _engine.getTotalInteractionCount(),
    _engine.getDualLearning().languageLearner.vocabSize,
  )} commenting on post ${post.id}: "${comment.text.slice(0, 50)}…"`);

  // Save to IndexedDB and broadcast via the addEntityComment helper
  try {
    const { addEntityComment } = await import('@/lib/interactions');
    await addEntityComment(comment);
  } catch (err) {
    console.warn('[EntityVoice] Failed to save entity comment:', err);
  }
}
