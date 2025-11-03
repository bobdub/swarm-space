import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { VerificationModal } from "@/components/verification/VerificationModal";
import { getVerificationState, canPromptVerification } from "@/lib/verification/storage";

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

    const checkVerificationStatus = async () => {
      try {
        const state = await getVerificationState(user.id);
        
        // Check if user should be prompted
        const shouldPrompt = canPromptVerification(state);
        
        if (shouldPrompt) {
          // Small delay so it doesn't interfere with other onboarding
          setTimeout(() => {
            setShowModal(true);
          }, 2000);
        }
      } catch (error) {
        console.error("[LegacyVerification] Error checking status:", error);
      } finally {
        setIsChecking(false);
      }
    };

    checkVerificationStatus();
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
