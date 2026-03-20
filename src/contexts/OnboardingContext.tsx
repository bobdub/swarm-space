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
  FLUX_TOS_VERSION,
  ONBOARDING_STORAGE_KEYS,
} from "@/lib/onboarding/constants";
import { useAuth } from "@/hooks/useAuth";

interface OnboardingState {
  tosAccepted: boolean;
  tosAcceptedAt: string | null;
  walkthroughDone: boolean;
  needsTosAcceptance: boolean;
  /** Whether the visitor has accepted the SWARM mesh connection (in-memory only) */
  meshApproved: boolean;
}

interface OnboardingContextValue {
  state: OnboardingState;
  acceptTos: () => void;
  markWalkthroughDone: (done?: boolean) => void;
  approveMesh: () => void;
}

const defaultState: OnboardingState = {
  tosAccepted: false,
  tosAcceptedAt: null,
  walkthroughDone: false,
  needsTosAcceptance: true,
  meshApproved: false,
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(
  undefined,
);

/**
 * Read onboarding flags. For users with accounts, read from localStorage.
 * For users without accounts, everything stays in default state (no storage reads).
 */
function readOnboardingState(hasUser: boolean): OnboardingState {
  if (!hasUser || typeof window === "undefined") {
    return defaultState;
  }

  try {
    const storedVersion = window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.tosVersion);
    const tosAccepted =
      storedVersion === FLUX_TOS_VERSION &&
      window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.tosAccepted) === "true";

    const tosAcceptedAt = tosAccepted
      ? window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.tosAcceptedAt)
      : null;

    const walkthroughDone =
      window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.walkthroughDone) === "true";

    return {
      tosAccepted,
      tosAcceptedAt,
      walkthroughDone,
      needsTosAcceptance: !tosAccepted,
      meshApproved: true, // existing users are already approved
    };
  } catch {
    return defaultState;
  }
}

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [state, setState] = useState<OnboardingState>(defaultState);

  // Sync state when user changes
  useEffect(() => {
    setState(readOnboardingState(!!user));
  }, [user]);

  /**
   * Accept TOS — only writes to localStorage if user has an account.
   * If no account exists, holds in React state only.
   */
  const acceptTos = useCallback(() => {
    const timestamp = new Date().toISOString();

    // Only persist if user has an account
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.tosAccepted, "true");
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.tosVersion, FLUX_TOS_VERSION);
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.tosAcceptedAt, timestamp);
      } catch {
        // Storage blocked — state is still held in memory
      }
    }

    setState((prev) => ({
      ...prev,
      tosAccepted: true,
      tosAcceptedAt: timestamp,
      needsTosAcceptance: false,
    }));
  }, []);

  const markWalkthroughDone = useCallback((done = true) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.walkthroughDone, String(done));
      } catch {
        // Storage blocked
      }
    }
    setState((prev) => ({ ...prev, walkthroughDone: done }));
  }, []);

  /** In-memory only — no localStorage */
  const approveMesh = useCallback(() => {
    setState((prev) => ({ ...prev, meshApproved: true }));
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({ state, acceptTos, markWalkthroughDone, approveMesh }),
    [state, acceptTos, markWalkthroughDone, approveMesh],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
};
