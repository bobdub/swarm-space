/**
 * Preview Context
 * 
 * Manages preview mode state and temporary P2P connections
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
import { useAuth } from '@/hooks/useAuth';
import { useP2P } from '@/hooks/useP2P';

interface PreviewContextValue {
  isPreviewMode: boolean;
  previewSession: PreviewSession | null;
  exitPreview: () => void;
}

const PreviewContext = createContext<PreviewContextValue>({
  isPreviewMode: false,
  previewSession: null,
  exitPreview: () => {},
});

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const { user } = useAuth();
  const p2p = useP2P();

  useEffect(() => {
    // Check URL for preview mode on mount
    const session = parsePreviewMode();
    if (session) {
      startPreviewSession(session);
      setPreviewSession(session);

      // Establish temporary P2P connection
      if (p2p.isEnabled) {
        p2p.connectToPeer(session.creatorPeerId, {
          manual: true,
          source: 'preview-mode',
        });
      }
    } else {
      // Check if already in preview session
      const existing = getPreviewSession();
      setPreviewSession(existing);
    }
  }, []);

  useEffect(() => {
    // Award referral when user signs up during preview
    if (user && previewSession) {
      (async () => {
        const shouldAward = await shouldAwardReferral(previewSession);
        if (shouldAward) {
          // Get creator's user ID from connection
          const connections = p2p.getActivePeerConnections();
          const connection = connections.find(
            c => c.peerId === previewSession.creatorPeerId
          );

          if (connection?.userId) {
            await awardReferralReward({
              creatorUserId: connection.userId,
              creatorPeerId: previewSession.creatorPeerId,
              newUserId: user.id,
              referralType: previewSession.isProfileFeed ? 'profile' : 'post',
              referredPostId: previewSession.postId,
            });
          }
        }

        // Exit preview mode after signup
        exitPreview();
      })();
    }
  }, [user, previewSession]);

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

  return (
    <PreviewContext.Provider
      value={{
        isPreviewMode: previewSession !== null,
        previewSession,
        exitPreview,
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}
