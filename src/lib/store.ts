// IndexedDB wrapper for local storage

const DB_NAME = "imagination-db";
const DB_VERSION = 6;

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
  createdAt: string;
  owner?: string;
  fileKey?: string;
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
      const db = (e.target as IDBOpenDBRequest).result;
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
    }

    if (!db.objectStoreNames.contains("notifications")) {
      const notifStore = db.createObjectStore("notifications", {
        keyPath: "id",
      });
      notifStore.createIndex("userId", "userId", { unique: false });
      notifStore.createIndex("read", "read", { unique: false });
      notifStore.createIndex("createdAt", "createdAt", { unique: false });
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
