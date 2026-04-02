/**
 * Entity Voice Integration — listens for post and comment events and triggers
 * the network entity's voice module to potentially comment or reply.
 *
 * Milestone posts: The entity only creates top-level feed posts when its brain
 * stage transitions (e.g. Brainstem → Limbic). Comments continue normally.
 */

import { getEntityVoice, ENTITY_USER_ID, getShyMode } from './entityVoice';
import { getSharedNeuralEngine } from './sharedNeuralEngine';
import { containsEntityMention } from '@/lib/mentions';
import type { ContentEvent } from './dualLearningFusion';
import type { Post, Comment } from '@/types';

let _listening = false;

const MILESTONES_STORAGE_KEY = 'entity-milestones-reached';

function getReachedMilestones(): Set<number> {
  try {
    const raw = localStorage.getItem(MILESTONES_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch { /* ignore */ }
  return new Set();
}

function persistMilestone(stage: number): void {
  const set = getReachedMilestones();
  set.add(stage);
  try { localStorage.setItem(MILESTONES_STORAGE_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

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
    const forceEntity = Boolean(postData._forceEntityReply);
    if (getShyMode() && !forceEntity) return;
    await evaluateAndComment(postData as unknown as Post, forceEntity);
  });

  // Listen for new comments — evaluate reply
  window.addEventListener('p2p-comment-created', async (e: Event) => {
    const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
    if (!detail || !detail.comment) return;
    const comment = detail.comment as Comment & { _forceEntityReply?: boolean };

    // ── FIX: Ignore the entity's own comments to prevent feedback loops ──
    if (comment.author === ENTITY_USER_ID) return;

    const forceEntity = Boolean(comment._forceEntityReply) || containsEntityMention(comment.text ?? '');
    if (getShyMode() && !forceEntity) return;
    // Small delay so the original comment settles in the UI
    setTimeout(() => evaluateAndReply(comment, forceEntity), 2000 + Math.random() * 3000);
  });

  console.log('[EntityVoice] 🧠 Listener initialized (posts + comments + @mentions)');
}

function feedSharedEngine(text: string, post?: Post): void {
  try {
    const engine = getSharedNeuralEngine();
    const voice = getEntityVoice();

    // Capture brain stage BEFORE feeding
    const totalBefore = engine.getTotalInteractionCount();
    const vocabBefore = engine.getDualLearning().languageLearner.vocabSize;
    const stageBefore = voice.computeBrainStage(totalBefore, vocabBefore);

    // Register a synthetic interaction so brain stage advances
    engine.onInteraction('entity-voice-eval', { kind: 'sync', success: true });
    // Feed content into dual learning (bypasses creativity gate for early growth)
    const contentEvent: ContentEvent = {
      text: text ?? '',
      reactions: post?.reactions?.length ?? 0,
      comments: post?.commentCount ?? 0,
      shares: 0,
      trustScore: 50,
      timestamp: Date.now(),
    };
    const dl = engine.getDualLearning();
    dl.ingestContentEvent(contentEvent);
    // Persist brain state so it survives reload
    engine.persistToStorage();

    // Capture brain stage AFTER feeding
    const totalAfter = engine.getTotalInteractionCount();
    const vocabAfter = engine.getDualLearning().languageLearner.vocabSize;
    const stageAfter = voice.computeBrainStage(totalAfter, vocabAfter);

    // ── Milestone post: brain stage transitioned ──
    if (stageAfter > stageBefore) {
      const reached = getReachedMilestones();
      if (!reached.has(stageAfter)) {
        persistMilestone(stageAfter);
        createMilestonePost(stageAfter, engine, voice).catch(err =>
          console.warn('[EntityVoice] Failed to create milestone post:', err),
        );
      }
    }
  } catch (err) {
    console.warn('[EntityVoice] Failed to feed shared engine:', err);
  }
}

async function createMilestonePost(
  stage: number,
  engine: ReturnType<typeof getSharedNeuralEngine>,
  voice: ReturnType<typeof getEntityVoice>,
): Promise<void> {
  const text = voice.generateMilestonePost(stage as 1 | 2 | 3 | 4 | 5 | 6, engine);
  if (!text) return;

  const ageLabel = voice.getAgeLabel();
  const fullText = `[${ageLabel}] 🧠 Brain Stage ${stage} reached\n\n${text}`;

  console.log(`[EntityVoice] 🎯 Milestone post for stage ${stage}: "${fullText.slice(0, 80)}…"`);

  try {
    const { createPost } = await import('@/lib/posts');
    await createPost({
      content: fullText,
      author: ENTITY_USER_ID,
      authorName: 'Imagination',
      type: 'text',
    });
  } catch (err) {
    console.warn('[EntityVoice] Failed to save milestone post:', err);
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

  try {
    const { addEntityComment } = await import('@/lib/interactions');
    await addEntityComment(reply);
  } catch (err) {
    console.warn('[EntityVoice] Failed to save entity reply:', err);
  }
}
