/**
 * Entity Voice Integration — listens for post events and triggers
 * the network entity's voice module to potentially comment.
 */

import { getEntityVoice, ENTITY_USER_ID, getShyMode } from './entityVoice';
import { getSharedNeuralEngine } from './sharedNeuralEngine';
import type { Post } from '@/types';

let _listening = false;

/**
 * Initialize the entity voice listener.
 * Call once when the app boots.
 */
export function initEntityVoiceListener(): void {
  if (_listening) return;
  _listening = true;

  window.addEventListener('p2p-entity-voice-evaluate', async (e: Event) => {
    const postData = (e as CustomEvent).detail as Record<string, unknown>;
    if (!postData || !postData.id) return;
    if (getShyMode()) return; // belt-and-suspenders shy check
    await evaluateAndComment(postData as unknown as Post);
  });

  console.log('[EntityVoice] 🧠 Listener initialized');
}

async function evaluateAndComment(post: Post): Promise<void> {
  const engine = getSharedNeuralEngine();
  const voice = getEntityVoice();

  if (post.author === ENTITY_USER_ID) return;
  if (!voice.shouldComment(post, engine)) return;

  const comment = voice.generateComment(post, engine);
  if (!comment) return;

  console.log(`[EntityVoice] 🧠 Stage ${voice.computeBrainStage(
    engine.getTotalInteractionCount(),
    engine.getDualLearning().languageLearner.vocabSize,
  )} commenting on post ${post.id}: "${comment.text.slice(0, 50)}…"`);

  try {
    const { addEntityComment } = await import('@/lib/interactions');
    await addEntityComment(comment);
  } catch (err) {
    console.warn('[EntityVoice] Failed to save entity comment:', err);
  }
}
