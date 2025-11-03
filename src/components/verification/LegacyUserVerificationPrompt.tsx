import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { VerificationModal } from "@/components/verification/VerificationModal";
import {
  getVerificationState,
  canPromptVerification,
  markPromptShown,
} from "@/lib/verification/storage";

/**
 * Prompts legacy users for optional verification with 24-hour cooldown
 */
export function LegacyUserVerificationPrompt() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (!user?.id || hasChecked) {
      setIsChecking(false);
      return;
    }

    let timeoutId: number | null = null;
    let isActive = true;

    const checkVerificationStatus = async () => {
      try {
        const state = await getVerificationState(user.id);

        if (!isActive) {
          return;
        }

        // Check if user should be prompted
        const shouldPrompt = canPromptVerification(state);

        console.log('[LegacyVerification] Check:', { 
          verified: state.verified, 
          shouldPrompt,
          promptShownAt: state.promptShownAt 
        });

        if (shouldPrompt) {
          // Small delay so it doesn't interfere with other onboarding
          timeoutId = window.setTimeout(() => {
            if (!isActive) {
              return;
            }

            setShowModal(true);
            setHasChecked(true);
            void markPromptShown(user.id).catch((error) => {
              console.error("[LegacyVerification] Failed to mark prompt shown:", error);
            });
          }, 2000);
        } else {
          setHasChecked(true);
        }
      } catch (error) {
        console.error("[LegacyVerification] Error checking status:", error);
        setHasChecked(true);
      } finally {
        if (isActive) {
          setIsChecking(false);
        }
      }
    };

    void checkVerificationStatus();

    return () => {
      isActive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [user?.id, hasChecked]);

  const handleComplete = () => {
    console.log('[LegacyVerification] Verification completed');
    setShowModal(false);
    setHasChecked(true);
  };

  const handleSkip = () => {
    console.log('[LegacyVerification] Verification skipped');
    setShowModal(false);
    setHasChecked(true);
  };

  if (isChecking || !user?.id) {
    return null;
  }

  return (
    <VerificationModal
      open={showModal}
      userId={user.id}
      isNewUser={false}
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  );
}
