/**
 * Entity Voice Integration — listens for post and comment events and triggers
 * the network entity's voice module to potentially comment or reply.
 */

import { getEntityVoice, ENTITY_USER_ID, getShyMode } from './entityVoice';
import { getSharedNeuralEngine } from './sharedNeuralEngine';
import { containsEntityMention } from '@/lib/mentions';
import type { ContentEvent } from './dualLearningFusion';
import type { Post, Comment } from '@/types';

let _listening = false;

/**
 * Initialize the entity voice listener.
 * Call once when the app boots.
 */
export function initEntityVoiceListener(): void {
  if (_listening) return;
  _listening = true;

  // Purge any previously-contaminated blocked tokens from vocabulary
  try {
    const engine = getSharedNeuralEngine();
    engine.getDualLearning().languageLearner.purgeBlockedTokens();
  } catch { /* engine may not be ready yet */ }

  // Listen for new posts
  window.addEventListener('p2p-entity-voice-evaluate', async (e: Event) => {
    const postData = (e as CustomEvent).detail as Record<string, unknown>;
    if (!postData || !postData.id) return;
    const forceEntity = Boolean(postData._forceEntityReply);
    if (getShyMode() && !forceEntity) return;
    await evaluateAndComment(postData as unknown as Post, forceEntity);
  });

  // Listen for new comments — evaluate reply
  window.addEventListener('p2p-comment-created', async (e: Event) => {
    const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
    if (!detail || !detail.comment) return;
    const comment = detail.comment as Comment & { _forceEntityReply?: boolean };
    const forceEntity = Boolean(comment._forceEntityReply) || containsEntityMention(comment.text ?? '');
    if (getShyMode() && !forceEntity) return;
    // Small delay so the original comment settles in the UI
    setTimeout(() => evaluateAndReply(comment, forceEntity), 2000 + Math.random() * 3000);
  });

  console.log('[EntityVoice] 🧠 Listener initialized (posts + comments + @mentions)');
}

function feedSharedEngine(text: string, post?: Post, recentForOverlap?: string): void {
  try {
    const engine = getSharedNeuralEngine();
    // Register a synthetic interaction so brain stage advances
    engine.onInteraction('entity-voice-eval', { kind: 'sync', success: true });
    // Route through engine.ingestContentEvent() which has the bootstrap exemption
    // instead of calling dl.ingestContentEvent() directly — this respects the
    // creativity gate for mature nodes while allowing early-life learning
    const contentEvent: ContentEvent = {
      text: text ?? '',
      reactions: post?.reactions?.length ?? 0,
      comments: post?.commentCount ?? 0,
      shares: 0,
      trustScore: 50,
      timestamp: Date.now(),
      recentForOverlap,
    };
    engine.ingestContentEvent(contentEvent);
    // Persist brain state so it survives reload
    engine.persistToStorage();
  } catch (err) {
    console.warn('[EntityVoice] Failed to feed shared engine:', err);
  }
}

async function evaluateAndComment(post: Post, force = false): Promise<void> {
  const engine = getSharedNeuralEngine();
  const voice = getEntityVoice();

  if (post.author === ENTITY_USER_ID) return;

  // Always feed content into the shared engine for learning, regardless of shy mode
  feedSharedEngine(post.content ?? '', post);

  // ── Entanglement notifications for blog/video posts ──
  try {
    const isBlog = (post.content?.length ?? 0) >= 1000 || post.blogClassification === 'blog' || post.blogClassification === 'book';
    const isVideo = post.type === 'video' || (post.content ?? '').includes('youtube.com') || (post.content ?? '').includes('youtu.be');
    if (isBlog || isVideo) {
      const { getFollowerIds } = await import('@/lib/entanglements');
      const { createNotification } = await import('@/lib/notifications');
      const followers = await getFollowerIds(post.author);
      const contentType = isVideo ? 'video' : 'blog';
      const authorName = post.authorName || post.author.slice(0, 8);
      for (const followerId of followers) {
        await createNotification({
          userId: followerId,
          type: 'entanglement',
          triggeredBy: post.author,
          triggeredByName: authorName,
          postId: post.id,
          content: `published a new ${contentType}`,
        });
      }
      if (followers.length > 0) {
        console.log(`[EntityVoice] 🔗 Sent entanglement notifications to ${followers.length} follower(s) for ${contentType}`);
      }
    }
  } catch (err) {
    console.warn('[EntityVoice] Failed to send entanglement notifications:', err);
  }

  // If @Infinity or @Imagination was mentioned, bypass all gates
  const mentioned = force || containsEntityMention(post.content ?? '');
  const shouldComment = mentioned || voice.shouldComment(post, engine);
  console.log(`[EntityVoice] Evaluating post ${post.id} — shouldComment=${shouldComment}, mentioned=${mentioned}, shy=${getShyMode()}`);
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

async function evaluateAndReply(comment: Comment, force = false): Promise<void> {
  const engine = getSharedNeuralEngine();
  const voice = getEntityVoice();

  if (comment.author === ENTITY_USER_ID) return;

  // Feed comment text into shared engine for learning
  feedSharedEngine(comment.text ?? '');

  // If entity was @mentioned, bypass probability check
  const mentioned = force || containsEntityMention(comment.text ?? '');
  const should = mentioned || voice.shouldReply(comment, engine);
  console.log(`[EntityVoice] Evaluating comment ${comment.id} — shouldReply=${should}, mentioned=${mentioned}, shy=${getShyMode()}`);
  if (!should) return;

  const reply = voice.generateReply(comment, comment.postId, engine);
  if (!reply) return;

  console.log(`[EntityVoice] 🧠 Replying to comment ${comment.id}: "${reply.text.slice(0, 50)}…"`);

  // Feed Infinity's own reply back through the learner with the parent
  // comment as overlap reference. The field's curvature on the overlap
  // region damps the reward — parroting the user costs more than diverging.
  feedSharedEngine(reply.text ?? '', undefined, comment.text ?? '');

  try {
    const { addEntityComment } = await import('@/lib/interactions');
    await addEntityComment(reply);
  } catch (err) {
    console.warn('[EntityVoice] Failed to save entity reply:', err);
  }
}
