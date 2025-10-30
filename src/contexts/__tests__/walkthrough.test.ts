import { beforeEach, describe, expect, test } from "bun:test";
import {
  __nextStepAfterForTests,
  __readStoredProgressForTests,
  __writeStoredProgressForTests,
} from "../WalkthroughContext";
import { ONBOARDING_STORAGE_KEYS, WALKTHROUGH_STEPS } from "../../lib/onboarding/constants";

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createMockStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } satisfies MockStorage;
}

beforeEach(() => {
  (globalThis as unknown as { window: { localStorage: MockStorage } }).window = {
    localStorage: createMockStorage(),
  };
});

describe("walkthrough helpers", () => {
  test("nextStepAfter traverses walkthrough steps sequentially", () => {
    expect(__nextStepAfterForTests("welcome")).toBe("mesh");
    expect(__nextStepAfterForTests("mesh")).toBe("projects");
    expect(__nextStepAfterForTests("projects")).toBe("credits");
    expect(__nextStepAfterForTests("credits")).toBe("done");
    expect(__nextStepAfterForTests("done")).toBe("done");
    expect(__nextStepAfterForTests("unknown" as typeof WALKTHROUGH_STEPS[number])).toBe("welcome");
  });

  test("stored progress survives round trips through localStorage", () => {
    const progress = {
      current: "projects" as const,
      completed: ["welcome", "mesh"] as const,
      dismissed: false,
    };

    __writeStoredProgressForTests(progress);

    const raw = globalThis.window.localStorage.getItem(
      ONBOARDING_STORAGE_KEYS.walkthroughProgress,
    );
    expect(raw).not.toBeNull();

    const hydrated = __readStoredProgressForTests();
    expect(hydrated).not.toBeNull();
    expect(hydrated?.current).toBe("projects");
    expect(hydrated?.completed).toEqual(["welcome", "mesh"]);
    expect(hydrated?.dismissed).toBe(false);
  });

  test("writing null progress clears the stored record", () => {
    globalThis.window.localStorage.setItem(
      ONBOARDING_STORAGE_KEYS.walkthroughProgress,
      JSON.stringify({ current: "mesh", completed: ["welcome"] }),
    );

    __writeStoredProgressForTests(null);

    const hydrated = __readStoredProgressForTests();
    expect(hydrated).toBeNull();
  });
});
