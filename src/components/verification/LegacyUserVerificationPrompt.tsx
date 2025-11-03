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

  useEffect(() => {
    if (!user?.id) {
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

        if (shouldPrompt) {
          // Small delay so it doesn't interfere with other onboarding
          timeoutId = window.setTimeout(() => {
            if (!isActive) {
              return;
            }

            setShowModal(true);
            void markPromptShown(user.id).catch((error) => {
              console.error("[LegacyVerification] Failed to mark prompt shown:", error);
            });
          }, 2000);
        }
      } catch (error) {
        console.error("[LegacyVerification] Error checking status:", error);
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
  }, [user?.id]);

  const handleComplete = () => {
    setShowModal(false);
  };

  const handleSkip = () => {
    setShowModal(false);
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
