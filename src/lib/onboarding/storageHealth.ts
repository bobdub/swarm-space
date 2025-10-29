export interface StorageHealth {
  localStorageAvailable: boolean;
  indexedDbAvailable: boolean;
  persistentStorageGranted: boolean | null;
  issues: string[];
}

const TEST_DB_NAME = "__flux_storage_health__";

function generateTestKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function checkLocalStorage(): { available: boolean; issue?: string } {
  if (typeof window === "undefined") {
    return { available: false, issue: "Window context unavailable" };
  }

  try {
    const testKey = `flux-health-${generateTestKey()}`;
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return { available: true };
  } catch (error) {
    console.warn("[StorageHealth] localStorage unavailable", error);
    return {
      available: false,
      issue:
        "Local storage appears to be blocked. Flux Mesh cannot persist onboarding state.",
    };
  }
}

async function ensurePersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean | null;
  issue?: string;
}> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return { supported: false, persisted: null };
  }

  const { storage } = navigator;

  if (!storage || typeof storage.persisted !== "function") {
    return { supported: false, persisted: null };
  }

  try {
    const alreadyPersisted = await storage.persisted();
    if (alreadyPersisted) {
      return { supported: true, persisted: true };
    }

    if (typeof storage.persist === "function") {
      const granted = await storage.persist();
      if (granted) {
        return { supported: true, persisted: true };
      }

      return {
        supported: true,
        persisted: false,
        issue:
          "Browser privacy settings are blocking persistent storage. Accept the storage permission prompt (Brave users may need to allow this explicitly) so Flux Mesh identities are not cleared.",
      };
    }

    return {
      supported: true,
      persisted: false,
      issue:
        "This browser does not expose a persistent storage request. Check privacy settings to keep Flux Mesh accounts from being cleared.",
    };
  } catch (error) {
    console.warn("[StorageHealth] Persistent storage request failed", error);
    return {
      supported: true,
      persisted: false,
      issue:
        "We could not enable persistent storage. Adjust your browser's storage permissions to prevent local accounts from being deleted.",
    };
  }
}

function checkIndexedDb(): Promise<{ available: boolean; issue?: string }> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve({
      available: false,
      issue: "IndexedDB is not supported in this environment.",
    });
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      console.warn("[StorageHealth] IndexedDB check timed out");
      resolve({
        available: false,
        issue:
          "IndexedDB requests are timing out. Local account recovery and media storage may fail.",
      });
    }, 3000);

    try {
      const request = window.indexedDB.open(TEST_DB_NAME, 1);
      request.onerror = () => {
        window.clearTimeout(timeout);
        const error = request.error;
        console.warn("[StorageHealth] IndexedDB unavailable", error);
        resolve({
          available: false,
          issue:
            "IndexedDB requests were rejected. Check browser privacy settings to enable local storage.",
        });
      };

      request.onsuccess = () => {
        window.clearTimeout(timeout);
        const db = request.result;
        db.close();
        window.indexedDB.deleteDatabase(TEST_DB_NAME);
        resolve({ available: true });
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("health", { keyPath: "id" });
      };
    } catch (error) {
      window.clearTimeout(timeout);
      console.warn("[StorageHealth] IndexedDB exception", error);
      resolve({
        available: false,
        issue:
          "IndexedDB could not be accessed. Offline sync and account recovery may be limited.",
      });
    }
  });
}

export async function assessStorageHealth(): Promise<StorageHealth> {
  const issues: string[] = [];

  if (typeof window === "undefined") {
    return {
      localStorageAvailable: false,
      indexedDbAvailable: false,
      persistentStorageGranted: null,
      issues: ["Storage checks require a browser environment."],
    };
  }

  const localStorageStatus = checkLocalStorage();
  if (!localStorageStatus.available && localStorageStatus.issue) {
    issues.push(localStorageStatus.issue);
  }

  const [persistentStatus, indexedDbStatus] = await Promise.all([
    ensurePersistentStorage(),
    checkIndexedDb(),
  ]);
  if (persistentStatus.issue) {
    issues.push(persistentStatus.issue);
  }
  if (!indexedDbStatus.available && indexedDbStatus.issue) {
    issues.push(indexedDbStatus.issue);
  }

  return {
    localStorageAvailable: localStorageStatus.available,
    indexedDbAvailable: indexedDbStatus.available,
    persistentStorageGranted: persistentStatus.persisted,
    issues,
  };
}
