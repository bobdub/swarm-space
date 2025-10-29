import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ONBOARDING_STORAGE_KEYS,
  WALKTHROUGH_STEPS,
  type WalkthroughStep,
} from "@/lib/onboarding/constants";
import { useOnboarding } from "./OnboardingContext";

interface WalkthroughState {
  currentStep: WalkthroughStep;
  completedSteps: WalkthroughStep[];
  isActive: boolean;
  isDismissed: boolean;
}

interface WalkthroughContextValue {
  state: WalkthroughState;
  start: () => void;
  completeStep: (step?: WalkthroughStep) => void;
  goToStep: (step: WalkthroughStep) => void;
  dismiss: () => void;
  resume: () => void;
  reset: () => void;
}

interface StoredProgress {
  current: WalkthroughStep;
  completed: WalkthroughStep[];
  dismissed?: boolean;
}

const defaultState: WalkthroughState = {
  currentStep: WALKTHROUGH_STEPS[0],
  completedSteps: [],
  isActive: false,
  isDismissed: false,
};

const CORE_WALKTHROUGH_STEPS = WALKTHROUGH_STEPS.filter(
  (step) => step !== "done",
);

const WalkthroughContext = createContext<WalkthroughContextValue | undefined>(
  undefined,
);

function sanitizeStep(step: WalkthroughStep | string): WalkthroughStep {
  return WALKTHROUGH_STEPS.includes(step as WalkthroughStep)
    ? (step as WalkthroughStep)
    : WALKTHROUGH_STEPS[0];
}

function sanitizeCompleted(steps: WalkthroughStep[] | string[]): WalkthroughStep[] {
  const allowed = new Set<WalkthroughStep>();

  for (const step of steps) {
    const resolved = sanitizeStep(step as WalkthroughStep);
    allowed.add(resolved);
  }

  return Array.from(allowed);
}

function readStoredProgress(): StoredProgress | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(
      ONBOARDING_STORAGE_KEYS.walkthroughProgress,
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredProgress;
    return {
      current: sanitizeStep(parsed.current),
      completed: sanitizeCompleted(parsed.completed ?? []),
      dismissed: Boolean(parsed.dismissed),
    };
  } catch (error) {
    console.warn("[Walkthrough] Failed to load stored progress", error);
    return null;
  }
}

function writeStoredProgress(progress: StoredProgress | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!progress) {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEYS.walkthroughProgress);
      return;
    }

    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEYS.walkthroughProgress,
      JSON.stringify(progress),
    );
  } catch (error) {
    console.warn("[Walkthrough] Failed to persist progress", error);
  }
}

function nextStepAfter(step: WalkthroughStep): WalkthroughStep {
  const currentIndex = WALKTHROUGH_STEPS.indexOf(step);
  if (currentIndex === -1) {
    return WALKTHROUGH_STEPS[0];
  }

  return WALKTHROUGH_STEPS[Math.min(currentIndex + 1, WALKTHROUGH_STEPS.length - 1)];
}

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const { state: onboardingState, markWalkthroughDone } = useOnboarding();
  const [state, setState] = useState<WalkthroughState>(() => defaultState);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = readStoredProgress();

    if (stored) {
      setState((previous) => ({
        ...previous,
        currentStep: stored.current,
        completedSteps: stored.completed,
        isActive: !onboardingState.walkthroughDone && !stored.dismissed,
        isDismissed: Boolean(stored.dismissed),
      }));
      return;
    }

    if (onboardingState.walkthroughDone) {
      setState({
        currentStep: "done",
        completedSteps: WALKTHROUGH_STEPS.slice(),
        isActive: false,
        isDismissed: false,
      });
    }
  }, [onboardingState.walkthroughDone]);

  const writeProgress = useCallback(
    (updater: (progress: StoredProgress | null) => StoredProgress | null) => {
      const stored = readStoredProgress();
      const next = updater(stored);
      writeStoredProgress(next);
    },
    [],
  );

  const start = useCallback(() => {
    setState((previous) => {
      const completedSet = new Set(previous.completedSteps);
      const firstIncomplete = CORE_WALKTHROUGH_STEPS.find(
        (step) => !completedSet.has(step),
      );

      const current = firstIncomplete ?? "done";

      writeProgress(() => ({
        current,
        completed: Array.from(completedSet),
        dismissed: false,
      }));

      return {
        currentStep: current,
        completedSteps: Array.from(completedSet),
        isActive: current !== "done",
        isDismissed: false,
      };
    });
  }, [writeProgress]);

  const completeStep = useCallback(
    (step?: WalkthroughStep) => {
      setState((previous) => {
        const target = step ?? previous.currentStep;
        const completedSet = new Set(previous.completedSteps);
        completedSet.add(target);

        const coreCompleted = CORE_WALKTHROUGH_STEPS.every((checkpoint) =>
          completedSet.has(checkpoint),
        );

        if (coreCompleted) {
          completedSet.add("done");
        }

        const nextStep = coreCompleted
          ? "done"
          : nextStepAfter(target ?? previous.currentStep);

        const updatedState: WalkthroughState = {
          currentStep: nextStep,
          completedSteps: Array.from(completedSet),
          isActive: !coreCompleted,
          isDismissed: false,
        };

        writeProgress(() => ({
          current: updatedState.currentStep,
          completed: updatedState.completedSteps,
          dismissed: false,
        }));

        if (coreCompleted && !onboardingState.walkthroughDone) {
          markWalkthroughDone(true);
        }

        return updatedState;
      });
    },
    [markWalkthroughDone, onboardingState.walkthroughDone, writeProgress],
  );

  const goToStep = useCallback((step: WalkthroughStep) => {
    setState((previous) => {
      const next = sanitizeStep(step);
      writeProgress((stored) => ({
        current: next,
        completed: stored?.completed ?? previous.completedSteps,
        dismissed: stored?.dismissed ?? previous.isDismissed,
      }));

      return {
        ...previous,
        currentStep: next,
        isActive: next !== "done" && !previous.isDismissed,
      };
    });
  }, [writeProgress]);

  const dismiss = useCallback(() => {
    setState((previous) => {
      writeProgress((stored) => ({
        current: stored?.current ?? previous.currentStep,
        completed: stored?.completed ?? previous.completedSteps,
        dismissed: true,
      }));

      return {
        ...previous,
        isActive: false,
        isDismissed: true,
      };
    });
  }, [writeProgress]);

  const resume = useCallback(() => {
    setState((previous) => {
      const completedSet = new Set(previous.completedSteps);
      const firstIncomplete = CORE_WALKTHROUGH_STEPS.find(
        (step) => !completedSet.has(step),
      );
      const current = firstIncomplete ?? previous.currentStep;

      writeProgress((stored) => ({
        current,
        completed: stored?.completed ?? previous.completedSteps,
        dismissed: false,
      }));

      return {
        ...previous,
        currentStep: current,
        isActive: current !== "done",
        isDismissed: false,
      };
    });
  }, [writeProgress]);

  const reset = useCallback(() => {
    writeStoredProgress(null);
    markWalkthroughDone(false);
    setState(defaultState);
  }, [markWalkthroughDone]);

  const value = useMemo<WalkthroughContextValue>(
    () => ({ state, start, completeStep, goToStep, dismiss, resume, reset }),
    [state, start, completeStep, goToStep, dismiss, resume, reset],
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
    </WalkthroughContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWalkthrough() {
  const context = useContext(WalkthroughContext);
  if (!context) {
    throw new Error("useWalkthrough must be used within a WalkthroughProvider");
  }

  return context;
}
