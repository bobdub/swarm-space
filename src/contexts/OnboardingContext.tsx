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

interface OnboardingState {
  tosAccepted: boolean;
  tosAcceptedAt: string | null;
  walkthroughDone: boolean;
  needsTosAcceptance: boolean;
}

interface OnboardingContextValue {
  state: OnboardingState;
  acceptTos: () => void;
  markWalkthroughDone: (done?: boolean) => void;
}

const defaultState: OnboardingState = {
  tosAccepted: false,
  tosAcceptedAt: null,
  walkthroughDone: false,
  needsTosAcceptance: true,
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(
  undefined,
);

const TRUTHY_TOKENS = new Set(["true", "1", "yes", "y", "on", "accepted"]);
const FALSY_TOKENS = new Set(["false", "0", "no", "n", "off", "rejected"]);

function readBooleanFromStorage(key: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const rawValue = window.localStorage.getItem(key);

    if (rawValue == null) {
      return false;
    }

    const normalized = rawValue.trim().toLowerCase();

    if (TRUTHY_TOKENS.has(normalized)) {
      return true;
    }

    if (FALSY_TOKENS.has(normalized)) {
      return false;
    }

    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === "boolean") {
        return parsed;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        ("accepted" in parsed || "value" in parsed)
      ) {
        const candidate =
          "accepted" in parsed ? parsed.accepted : parsed.value;
        if (typeof candidate === "boolean") {
          return candidate;
        }
      }
    } catch {
      // fall through to legacy handling below
    }

    return rawValue === "true";
  } catch (error) {
    console.warn(`[Onboarding] Unable to read boolean key ${key}:`, error);
    return false;
  }
}

function writeBooleanToStorage(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch (error) {
    console.warn(`[Onboarding] Unable to write boolean key ${key}:`, error);
  }
}

function readStringFromStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[Onboarding] Unable to read string key ${key}:`, error);
    return null;
  }
}

function writeStringToStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[Onboarding] Unable to write string key ${key}:`, error);
  }
}

function readTimestampFromStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return null;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return new Date(parsed).toISOString();
  } catch (error) {
    console.warn(`[Onboarding] Unable to read timestamp key ${key}:`, error);
    return null;
  }
}

function writeTimestampToStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[Onboarding] Unable to write timestamp key ${key}:`, error);
  }
}

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<OnboardingState>(defaultState);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTosVersion = readStringFromStorage(
      ONBOARDING_STORAGE_KEYS.tosVersion,
    );
    const hasAcceptedCurrentVersion =
      storedTosVersion === FLUX_TOS_VERSION &&
      readBooleanFromStorage(ONBOARDING_STORAGE_KEYS.tosAccepted);
    const acceptanceTimestamp = hasAcceptedCurrentVersion
      ? readTimestampFromStorage(ONBOARDING_STORAGE_KEYS.tosAcceptedAt)
      : null;
    const walkthroughDone = readBooleanFromStorage(
      ONBOARDING_STORAGE_KEYS.walkthroughDone,
    );

    setState({
      tosAccepted: hasAcceptedCurrentVersion,
      tosAcceptedAt: acceptanceTimestamp,
      walkthroughDone,
      needsTosAcceptance: !hasAcceptedCurrentVersion,
    });
  }, []);

  const acceptTos = useCallback(() => {
    writeBooleanToStorage(ONBOARDING_STORAGE_KEYS.tosAccepted, true);
    writeStringToStorage(
      ONBOARDING_STORAGE_KEYS.tosVersion,
      FLUX_TOS_VERSION,
    );
    const timestamp = new Date().toISOString();
    writeTimestampToStorage(
      ONBOARDING_STORAGE_KEYS.tosAcceptedAt,
      timestamp,
    );

    setState((previous) => ({
      ...previous,
      tosAccepted: true,
      tosAcceptedAt: timestamp,
      needsTosAcceptance: false,
    }));
  }, []);

  const markWalkthroughDone = useCallback((done = true) => {
    writeBooleanToStorage(ONBOARDING_STORAGE_KEYS.walkthroughDone, done);
    setState((previous) => ({
      ...previous,
      walkthroughDone: done,
    }));
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({ state, acceptTos, markWalkthroughDone }),
    [state, acceptTos, markWalkthroughDone],
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
