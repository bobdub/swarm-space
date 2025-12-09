/**
 * Preview Context
 * 
 * Manages preview mode state and temporary P2P connections.
 * Preview mode allows unauthenticated users to view shared content
 * as an invitation to join the network.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  parsePreviewMode,
  getPreviewSession,
  startPreviewSession,
  clearPreviewSession,
  awardReferralReward,
  shouldAwardReferral,
  type PreviewSession,
} from '@/lib/preview/previewMode';

interface PreviewContextValue {
  isPreviewMode: boolean;
  previewSession: PreviewSession | null;
  exitPreview: () => void;
  /** Stores referral info for after signup */
  pendingReferral: PreviewSession | null;
  /** Called after signup to process referral */
  processReferralAfterSignup: (userId: string) => Promise<void>;
}

const PreviewContext = createContext<PreviewContextValue>({
  isPreviewMode: false,
  previewSession: null,
  exitPreview: () => {},
  pendingReferral: null,
  processReferralAfterSignup: async () => {},
});

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [pendingReferral, setPendingReferral] = useState<PreviewSession | null>(null);

  // Check URL for preview mode on mount - this runs BEFORE auth
  useEffect(() => {
    const session = parsePreviewMode();
    if (session) {
      console.log('[Preview] Detected preview mode from URL:', session);
      startPreviewSession(session);
      setPreviewSession(session);
      // Store as pending referral for after signup
      setPendingReferral(session);
    } else {
      // Check if already in preview session
      const existing = getPreviewSession();
      if (existing) {
        setPreviewSession(existing);
        setPendingReferral(existing);
      }
    }
  }, []);

  const exitPreview = () => {
    clearPreviewSession();
    setPreviewSession(null);
    
    // Clean URL
    if (window.location.search) {
      const url = new URL(window.location.href);
      url.searchParams.delete('peerID');
      url.searchParams.delete('postID');
      window.history.replaceState({}, '', url.toString());
    }
  };

  /**
   * Process referral reward after user signs up
   * Called from Auth page after successful signup
   */
  const processReferralAfterSignup = async (newUserId: string) => {
    if (!pendingReferral) {
      console.log('[Preview] No pending referral to process');
      return;
    }

    console.log('[Preview] Processing referral after signup:', pendingReferral);

    try {
      const shouldAward = await shouldAwardReferral(pendingReferral);
      if (shouldAward) {
        // Award referral using the creator's peer ID
        // The creator's user ID will be derived from peer ID
        await awardReferralReward({
          creatorUserId: pendingReferral.creatorPeerId, // Use peer ID as user ID fallback
          creatorPeerId: pendingReferral.creatorPeerId,
          newUserId,
          referralType: pendingReferral.isProfileFeed ? 'profile' : 'post',
          referredPostId: pendingReferral.postId,
        });
        console.log('[Preview] Referral reward processed successfully');
      }
    } catch (error) {
      console.error('[Preview] Failed to process referral:', error);
    }

    // Clear pending referral and exit preview mode
    setPendingReferral(null);
    exitPreview();
  };

  return (
    <PreviewContext.Provider
      value={{
        isPreviewMode: previewSession !== null,
        previewSession,
        exitPreview,
        pendingReferral,
        processReferralAfterSignup,
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}
