import { detectBraveBrowser } from "./browserDetection";

export interface StorageHealth {
  localStorageAvailable: boolean;
  indexedDbAvailable: boolean;
  issues: string[];
  braveDetected: boolean;
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
      issues: ["Storage checks require a browser environment."],
      braveDetected: false,
    };
  }

  const localStorageStatus = checkLocalStorage();
  if (!localStorageStatus.available && localStorageStatus.issue) {
    issues.push(localStorageStatus.issue);
  }

  const indexedDbStatus = await checkIndexedDb();
  if (!indexedDbStatus.available && indexedDbStatus.issue) {
    issues.push(indexedDbStatus.issue);
  }

  let braveDetected = false;
  try {
    braveDetected = await detectBraveBrowser();
  } catch (error) {
    console.warn("[StorageHealth] Brave detection failed", error);
  }

  return {
    localStorageAvailable: localStorageStatus.available,
    indexedDbAvailable: indexedDbStatus.available,
    issues,
    braveDetected,
  };
}
