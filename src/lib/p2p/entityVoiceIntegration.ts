/**
 * Entity Voice Integration — listens for post and comment events and triggers
 * the network entity's voice module to potentially comment or reply.
 */

import { getEntityVoice, ENTITY_USER_ID, getShyMode } from './entityVoice';
import { getSharedNeuralEngine } from './sharedNeuralEngine';
import type { Post, Comment } from '@/types';

let _listening = false;

/**
 * Initialize the entity voice listener.
 * Call once when the app boots.
 */
export function initEntityVoiceListener(): void {
  if (_listening) return;
  _listening = true;

  // Listen for new posts
  window.addEventListener('p2p-entity-voice-evaluate', async (e: Event) => {
    const postData = (e as CustomEvent).detail as Record<string, unknown>;
    if (!postData || !postData.id) return;
    if (getShyMode()) return;
    await evaluateAndComment(postData as unknown as Post);
  });

  // Listen for new comments — evaluate reply
  window.addEventListener('p2p-comment-created', async (e: Event) => {
    const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
    if (!detail || !detail.comment) return;
    if (getShyMode()) return;
    const comment = detail.comment as Comment;
    // Small delay so the original comment settles in the UI
    setTimeout(() => evaluateAndReply(comment), 2000 + Math.random() * 3000);
  });

  console.log('[EntityVoice] 🧠 Listener initialized (posts + comments)');
}

async function evaluateAndComment(post: Post): Promise<void> {
  const engine = getSharedNeuralEngine();
  const voice = getEntityVoice();

  if (post.author === ENTITY_USER_ID) return;

  const shouldComment = voice.shouldComment(post, engine);
  console.log(`[EntityVoice] Evaluating post ${post.id} — shouldComment=${shouldComment}, shy=${getShyMode()}`);
  if (!shouldComment) return;

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

async function evaluateAndReply(comment: Comment): Promise<void> {
  const engine = getSharedNeuralEngine();
  const voice = getEntityVoice();

  if (comment.author === ENTITY_USER_ID) return;

  const should = voice.shouldReply(comment, engine);
  console.log(`[EntityVoice] Evaluating comment ${comment.id} — shouldReply=${should}, shy=${getShyMode()}`);
  if (!should) return;

  const reply = voice.generateReply(comment, comment.postId, engine);
  if (!reply) return;

  console.log(`[EntityVoice] 🧠 Replying to comment ${comment.id}: "${reply.text.slice(0, 50)}…"`);

  try {
    const { addEntityComment } = await import('@/lib/interactions');
    await addEntityComment(reply);
  } catch (err) {
    console.warn('[EntityVoice] Failed to save entity reply:', err);
  }
}
