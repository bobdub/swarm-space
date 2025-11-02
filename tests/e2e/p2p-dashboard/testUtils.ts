export function installMemoryStorage(): () => void {
  type MemoryStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };

  const store = new Map<string, string>();
  const storage: MemoryStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  const cleanupSteps: Array<() => void> = [];

  const existingWindow = typeof window === 'undefined' ? undefined : window;
  if (existingWindow) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(existingWindow, 'localStorage');
    try {
      Object.defineProperty(existingWindow, 'localStorage', {
        configurable: true,
        value: storage,
      });
      cleanupSteps.push(() => {
        if (originalDescriptor) {
          Object.defineProperty(existingWindow, 'localStorage', originalDescriptor);
        } else {
          delete (existingWindow as unknown as Record<string, unknown>).localStorage;
        }
      });
    } catch {
      existingWindow.localStorage.clear();
      cleanupSteps.push(() => existingWindow.localStorage.clear());
      return () => {
        cleanupSteps.forEach((step) => step());
      };
    }
  } else {
    const fakeWindow = {
      localStorage: storage,
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
    };
    (globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
    cleanupSteps.push(() => {
      delete (globalThis as { window?: unknown }).window;
    });
  }

  return () => {
    cleanupSteps.forEach((step) => step());
  };
}
