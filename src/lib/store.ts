// IndexedDB wrapper for local storage

const DB_NAME = "imagination-db";
const DB_VERSION = 13;

export interface Chunk {
  ref: string;
  seq: number;
  total: number | null;
  size: number;
  iv: string;
  cipher: string;
  meta: {
    mime?: string;
    originalName?: string;
  };
}

export interface Manifest {
  fileId: string;
  chunks: string[];
  mime?: string;
  size?: number;
  originalName?: string;
  createdAt: string;
  owner?: string;
  fileKey?: string;
  signature?: string;
  signatureAlgorithm?: 'ed25519';
  signerPublicKey?: string;
  signedAt?: string;
}

export interface MetaEntry {
  k: string;
  v: unknown;
}

let dbInstance: IDBDatabase | null = null;

export async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const request = e.target as IDBOpenDBRequest;
      const db = request.result;
      const upgradeTx = request.transaction;
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { keyPath: "ref" });
      }
      if (!db.objectStoreNames.contains("manifests")) {
        db.createObjectStore("manifests", { keyPath: "fileId" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "k" });
      }
      if (!db.objectStoreNames.contains("posts")) {
        db.createObjectStore("posts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("postMetrics")) {
        const metricsStore = db.createObjectStore("postMetrics", { keyPath: "postId" });
        metricsStore.createIndex("viewCount", "viewCount", { unique: false });
        metricsStore.createIndex("viewTotal", "viewTotal", { unique: false });
        metricsStore.createIndex("creditTotal", "creditTotal", { unique: false });
        metricsStore.createIndex("creditCount", "creditCount", { unique: false });
        metricsStore.createIndex("updatedAt", "updatedAt", { unique: false });
      } else if (upgradeTx) {
        const metricsStore = upgradeTx.objectStore("postMetrics");
        if (!metricsStore.indexNames.contains("viewCount")) {
          metricsStore.createIndex("viewCount", "viewCount", { unique: false });
        }
        if (!metricsStore.indexNames.contains("viewTotal")) {
          metricsStore.createIndex("viewTotal", "viewTotal", { unique: false });
        }
        if (!metricsStore.indexNames.contains("creditTotal")) {
          metricsStore.createIndex("creditTotal", "creditTotal", { unique: false });
        }
        if (!metricsStore.indexNames.contains("creditCount")) {
          metricsStore.createIndex("creditCount", "creditCount", { unique: false });
        }
        if (!metricsStore.indexNames.contains("updatedAt")) {
          metricsStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("comments")) {
        const commentStore = db.createObjectStore("comments", { keyPath: "id" });
        commentStore.createIndex("author", "author", { unique: false });
        commentStore.createIndex("createdAt", "createdAt", { unique: false });
        commentStore.createIndex("postId", "postId", { unique: false });
      } else if (upgradeTx) {
        const commentStore = upgradeTx.objectStore("comments");
        if (!commentStore.indexNames.contains("author")) {
          commentStore.createIndex("author", "author", { unique: false });
        }
        if (!commentStore.indexNames.contains("createdAt")) {
          commentStore.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!commentStore.indexNames.contains("postId")) {
          commentStore.createIndex("postId", "postId", { unique: false });
        }
      }

      if (!db.objectStoreNames.contains("notifications")) {
        const notifStore = db.createObjectStore("notifications", {
          keyPath: "id",
        });
        notifStore.createIndex("userId", "userId", { unique: false });
        notifStore.createIndex("read", "read", { unique: false });
        notifStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("entanglements")) {
        const entangleStore = db.createObjectStore("entanglements", {
          keyPath: "id",
        });
        entangleStore.createIndex("userId", "userId", { unique: false });
        entangleStore.createIndex("targetUserId", "targetUserId", { unique: false });
        entangleStore.createIndex("userTargetKey", "userTargetKey", { unique: true });
      } else if (upgradeTx) {
        const entangleStore = upgradeTx.objectStore("entanglements");
        if (!entangleStore.indexNames.contains("userId")) {
          entangleStore.createIndex("userId", "userId", { unique: false });
        }
        if (!entangleStore.indexNames.contains("targetUserId")) {
          entangleStore.createIndex("targetUserId", "targetUserId", { unique: false });
        }
        if (!entangleStore.indexNames.contains("userTargetKey")) {
          entangleStore.createIndex("userTargetKey", "userTargetKey", { unique: true });
        }
      }
      if (!db.objectStoreNames.contains("tasks")) {
        const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
        taskStore.createIndex("projectId", "projectId", { unique: false });
        taskStore.createIndex("status", "status", { unique: false });
        taskStore.createIndex("assignees", "assignees", { multiEntry: true });
      }
      if (!db.objectStoreNames.contains("milestones")) {
        const milestoneStore = db.createObjectStore("milestones", { keyPath: "id" });
        milestoneStore.createIndex("projectId", "projectId", { unique: false });
        milestoneStore.createIndex("dueDate", "dueDate", { unique: false });
      }
      if (!db.objectStoreNames.contains("creditTransactions")) {
        const txStore = db.createObjectStore("creditTransactions", { keyPath: "id" });
        txStore.createIndex("fromUserId", "fromUserId", { unique: false });
        txStore.createIndex("toUserId", "toUserId", { unique: false });
        txStore.createIndex("type", "type", { unique: false });
        txStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("creditBalances")) {
        db.createObjectStore("creditBalances", { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains("connections")) {
        const connStore = db.createObjectStore("connections", { keyPath: "id" });
        connStore.createIndex("userId", "userId", { unique: false });
        connStore.createIndex("connectedUserId", "connectedUserId", { unique: false });
        connStore.createIndex("status", "status", { unique: false });
        connStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("replicas")) {
        const replicaStore = db.createObjectStore("replicas", { keyPath: "manifestId" });
        replicaStore.createIndex("storedAt", "storedAt", { unique: false });
        replicaStore.createIndex("redundancyTarget", "redundancyTarget", { unique: false });
      }
      if (!db.objectStoreNames.contains("achievementDefinitions")) {
        const achievementStore = db.createObjectStore("achievementDefinitions", { keyPath: "id" });
        achievementStore.createIndex("slug", "slug", { unique: true });
        achievementStore.createIndex("category", "category", { unique: false });
      } else if (upgradeTx) {
        const achievementStore = upgradeTx.objectStore("achievementDefinitions");
        if (!achievementStore.indexNames.contains("slug")) {
          achievementStore.createIndex("slug", "slug", { unique: true });
        }
        if (!achievementStore.indexNames.contains("category")) {
          achievementStore.createIndex("category", "category", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("achievementProgress")) {
        const progressStore = db.createObjectStore("achievementProgress", { keyPath: "id" });
        progressStore.createIndex("userId", "userId", { unique: false });
        progressStore.createIndex("achievementId", "achievementId", { unique: false });
        progressStore.createIndex("unlocked", "unlocked", { unique: false });
        progressStore.createIndex("userAchievement", "userAchievementKey", { unique: true });
      } else if (upgradeTx) {
        const progressStore = upgradeTx.objectStore("achievementProgress");
        if (!progressStore.indexNames.contains("userId")) {
          progressStore.createIndex("userId", "userId", { unique: false });
        }
        if (!progressStore.indexNames.contains("achievementId")) {
          progressStore.createIndex("achievementId", "achievementId", { unique: false });
        }
        if (!progressStore.indexNames.contains("unlocked")) {
          progressStore.createIndex("unlocked", "unlocked", { unique: false });
        }
        if (!progressStore.indexNames.contains("userAchievement")) {
          progressStore.createIndex("userAchievement", "userAchievementKey", { unique: true });
        }
      }
      if (!db.objectStoreNames.contains("qcmSamples")) {
        const qcmStore = db.createObjectStore("qcmSamples", { keyPath: "id" });
        qcmStore.createIndex("userId", "userId", { unique: false });
        qcmStore.createIndex("series", "series", { unique: false });
        qcmStore.createIndex("recordedAt", "recordedAt", { unique: false });
        qcmStore.createIndex("userSeries", "userSeriesKey", { unique: false });
      } else if (upgradeTx) {
        const qcmStore = upgradeTx.objectStore("qcmSamples");
        if (!qcmStore.indexNames.contains("userId")) {
          qcmStore.createIndex("userId", "userId", { unique: false });
        }
        if (!qcmStore.indexNames.contains("series")) {
          qcmStore.createIndex("series", "series", { unique: false });
        }
        if (!qcmStore.indexNames.contains("recordedAt")) {
          qcmStore.createIndex("recordedAt", "recordedAt", { unique: false });
        }
        if (!qcmStore.indexNames.contains("userSeries")) {
          qcmStore.createIndex("userSeries", "userSeriesKey", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("nodeMetricAggregates")) {
        const metricsStore = db.createObjectStore("nodeMetricAggregates", { keyPath: "id" });
        metricsStore.createIndex("userId", "userId", { unique: false });
        metricsStore.createIndex("metric", "metric", { unique: false });
        metricsStore.createIndex("bucket", "bucket", { unique: false });
        metricsStore.createIndex("userMetric", ["userId", "metric"], { unique: false });
        metricsStore.createIndex("userMetricBucket", ["userId", "metric", "bucket"], { unique: true });
      } else if (upgradeTx) {
        const metricsStore = upgradeTx.objectStore("nodeMetricAggregates");
        if (!metricsStore.indexNames.contains("userId")) {
          metricsStore.createIndex("userId", "userId", { unique: false });
        }
        if (!metricsStore.indexNames.contains("metric")) {
          metricsStore.createIndex("metric", "metric", { unique: false });
        }
        if (!metricsStore.indexNames.contains("bucket")) {
          metricsStore.createIndex("bucket", "bucket", { unique: false });
        }
        if (!metricsStore.indexNames.contains("userMetric")) {
          metricsStore.createIndex("userMetric", ["userId", "metric"], { unique: false });
        }
        if (!metricsStore.indexNames.contains("userMetricBucket")) {
          metricsStore.createIndex("userMetricBucket", ["userId", "metric", "bucket"], { unique: true });
        }
      }
    };
    
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(req.result);
    };
    
    req.onerror = () => reject(req.error);
  });
}

export async function put<T>(storeName: string, val: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(val);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(query);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Get chunk data by reference
export async function getChunk(ref: string): Promise<Uint8Array | null> {
  const chunk = await get<Chunk>("chunks", ref);
  if (!chunk) return null;
  
  // Decode base64 cipher text to Uint8Array
  const binary = atob(chunk.cipher);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
