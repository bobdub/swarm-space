/**
 * Preview Mode System
 * 
 * Handles temporary, sandboxed connections for content preview
 * without adding peers to permanent auto-connect list.
 */

import { put, get } from '../store';

export interface PreviewSession {
  creatorPeerId: string;
  postId?: string;
  isProfileFeed: boolean;
  startedAt: string;
  referralSource: string | null;
}

export interface ReferralReward {
  id: string;
  creatorUserId: string;
  creatorPeerId: string;
  newUserId: string;
  referralType: 'post' | 'profile';
  referredPostId?: string;
  credits: number;
  awardedAt: string;
}

const PREVIEW_SESSION_KEY = 'preview:current-session';
const REFERRAL_PREFIX = 'referral:reward:';

/**
 * Parse preview mode from URL
 */
export function parsePreviewMode(): PreviewSession | null {
  const params = new URLSearchParams(window.location.search);
  const peerIdParam = params.get('peerID');
  const postIdParam = params.get('postID');
  
  if (!peerIdParam) return null;
  
  // Check if this is a preview link (ends with -preview)
  const isPreview = peerIdParam.endsWith('-preview');
  if (!isPreview) return null;
  
  // Extract actual peer ID (remove -preview suffix)
  const creatorPeerId = peerIdParam.replace('-preview', '');
  
  return {
    creatorPeerId,
    postId: postIdParam || undefined,
    isProfileFeed: !postIdParam,
    startedAt: new Date().toISOString(),
    referralSource: peerIdParam,
  };
}

/**
 * Check if currently in preview mode
 */
export function isInPreviewMode(): boolean {
  const session = getPreviewSession();
  return session !== null;
}

/**
 * Get current preview session
 */
export function getPreviewSession(): PreviewSession | null {
  try {
    const stored = sessionStorage.getItem(PREVIEW_SESSION_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Start a preview session
 */
export function startPreviewSession(session: PreviewSession): void {
  sessionStorage.setItem(PREVIEW_SESSION_KEY, JSON.stringify(session));
  console.log('[Preview] Started preview session:', session);
}

/**
 * Clear preview session
 */
export function clearPreviewSession(): void {
  sessionStorage.removeItem(PREVIEW_SESSION_KEY);
  console.log('[Preview] Cleared preview session');
}

/**
 * Generate share link for post
 */
export function generatePostShareLink(postId: string, creatorPeerId: string): string {
  const base = window.location.origin;
  return `${base}/?peerID=${creatorPeerId}-preview&postID=${postId}`;
}

/**
 * Generate share link for profile feed
 */
export function generateProfileShareLink(creatorPeerId: string): string {
  const base = window.location.origin;
  return `${base}/?peerID=${creatorPeerId}-preview`;
}

/**
 * Award referral reward to creator
 */
export async function awardReferralReward(params: {
  creatorUserId: string;
  creatorPeerId: string;
  newUserId: string;
  referralType: 'post' | 'profile';
  referredPostId?: string;
}): Promise<ReferralReward> {
  const reward: ReferralReward = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...params,
    credits: 5, // Referral reward: 5 SWARM credits
    awardedAt: new Date().toISOString(),
  };

  // Store referral reward
  await put('rewards', {
    k: `${REFERRAL_PREFIX}${reward.id}`,
    v: reward,
  });

  // Award credits to creator via custom transaction
  const storeModule = await import('../store');
  
  const transaction: any = {
    id: crypto.randomUUID(),
    fromUserId: 'system',
    toUserId: params.creatorUserId,
    amount: reward.credits,
    type: 'referral_reward',
    createdAt: new Date().toISOString(),
    meta: {
      referralType: params.referralType,
      referredPostId: params.referredPostId,
    },
  };
  
  await storeModule.put('creditTransactions', transaction);
  
  // Update balance
  let balance = await storeModule.get<any>('creditBalances', params.creatorUserId);
  if (!balance) {
    balance = {
      userId: params.creatorUserId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
  
  balance.balance += reward.credits;
  balance.totalEarned += reward.credits;
  balance.lastUpdated = new Date().toISOString();
  
  await storeModule.put('creditBalances', balance);

  console.log('[Preview] Awarded referral reward:', reward);

  // Dispatch event for P2P sync
  window.dispatchEvent(new CustomEvent('referral-reward', { detail: reward }));

  return reward;
}

/**
 * Get referral rewards for a user
 */
export async function getReferralRewards(userId: string): Promise<ReferralReward[]> {
  const { getAll } = await import('../store');
  const allRewards = await getAll<{ k: string; v: ReferralReward }>('rewards');
  
  return allRewards
    .filter(r => r.k.startsWith(REFERRAL_PREFIX))
    .map(r => r.v)
    .filter(r => r.creatorUserId === userId)
    .sort((a, b) => new Date(b.awardedAt).getTime() - new Date(a.awardedAt).getTime());
}

/**
 * Check if user should be rewarded for referral
 */
export async function shouldAwardReferral(session: PreviewSession): Promise<boolean> {
  if (!session.referralSource) return false;
  
  // Check if we already awarded this referral
  const { getAll } = await import('../store');
  const allRewards = await getAll<{ k: string; v: ReferralReward }>('rewards');
  
  const existingReward = allRewards.find(r => 
    r.v.creatorPeerId === session.creatorPeerId &&
    r.v.referredPostId === session.postId
  );
  
  return !existingReward;
}
