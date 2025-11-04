import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { SimpleVerificationModal } from "@/components/verification/SimpleVerificationModal";
import {
  getVerificationState,
  canPromptVerification,
  markPromptShown,
} from "@/lib/verification/storage";

/**
 * Prompts users for verification after TOS acceptance
 */
export function LegacyUserVerificationPrompt() {
  const { user } = useAuth();
  const { state: onboardingState } = useOnboarding();
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasChecked, setHasChecked] = useState(false);

  console.log('[LegacyVerification] State:', {
    hasUser: !!user,
    tosAccepted: onboardingState.tosAccepted,
    showModal,
  });

  useEffect(() => {
    if (!user?.id || hasChecked || !onboardingState.tosAccepted) {
      setIsChecking(false);
      return;
    }

    let isActive = true;

    const checkVerificationStatus = async () => {
      try {
        const state = await getVerificationState(user.id);
        
        if (!isActive) return;

        const shouldPrompt = canPromptVerification(state);

        console.log('[LegacyVerification] Check:', { 
          verified: state.verified, 
          shouldPrompt
        });

        if (shouldPrompt) {
          console.log('[LegacyVerification] Showing modal');
          setShowModal(true);
          setHasChecked(true);
          void markPromptShown(user.id);
        } else {
          setHasChecked(true);
        }
      } catch (error) {
        console.error("[LegacyVerification] Error:", error);
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
    };
  }, [user?.id, hasChecked, onboardingState.tosAccepted]);

  const handleComplete = () => {
    console.log('[LegacyVerification] Complete');
    setShowModal(false);
  };

  const handleSkip = () => {
    console.log('[LegacyVerification] Skipped');
    setShowModal(false);
  };

  if (!user?.id || isChecking) {
    return null;
  }

  return (
    <SimpleVerificationModal
      open={showModal}
      userId={user.id}
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  );
}
