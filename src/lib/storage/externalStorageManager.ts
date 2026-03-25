const EXTERNAL_HANDLE_DB = 'swarm-external-storage';
const EXTERNAL_HANDLE_STORE = 'handles';
const EXTERNAL_HANDLE_KEY = 'root';

export type ExternalStorageStatus =
  | 'connected'
  | 'permission-required'
  | 'drive-missing'
  | 'read-only'
  | 'degraded-fallback';

type QueueTask = {
  key: string;
  run: () => Promise<void>;
};

type Listener = (status: ExternalStorageStatus) => void;

async function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EXTERNAL_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EXTERNAL_HANDLE_STORE)) {
        db.createObjectStore(EXTERNAL_HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open external handle DB'));
  });
}

async function saveHandleToDb(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(EXTERNAL_HANDLE_STORE, 'readwrite');
    tx.objectStore(EXTERNAL_HANDLE_STORE).put(handle, EXTERNAL_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save external handle'));
  });
  db.close();
}

async function loadHandleFromDb(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(EXTERNAL_HANDLE_STORE, 'readonly');
    const request = tx.objectStore(EXTERNAL_HANDLE_STORE).get(EXTERNAL_HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Failed to load external handle'));
  });
  db.close();
  return handle;
}

class ExternalStorageManager {
  private handle: FileSystemDirectoryHandle | null = null;
  private status: ExternalStorageStatus = 'permission-required';
  private queue: QueueTask[] = [];
  private listeners = new Set<Listener>();
  private initialized = false;
  private flushInFlight = false;

  private setStatus(next: ExternalStorageStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.listeners.forEach((listener) => listener(next));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): ExternalStorageStatus {
    return this.status;
  }

  getHandle(): FileSystemDirectoryHandle | null {
    return this.handle;
  }

  async initialize(): Promise<void> {
    if (this.initialized || typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return;
    }
    this.initialized = true;
    try {
      this.handle = await loadHandleFromDb();
    } catch {
      this.handle = null;
    }

    if (!this.handle) {
      this.setStatus('permission-required');
    } else {
      await this.validatePermissions();
    }

    window.addEventListener('focus', () => {
      void this.validatePermissions().then(() => this.flushQueuedWrites());
    });
    window.addEventListener('online', () => {
      void this.validatePermissions().then(() => this.flushQueuedWrites());
    });
  }

  async setDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    this.handle = handle;
    await saveHandleToDb(handle);
    await this.validatePermissions(true);
  }

  async requestReauthorization(): Promise<ExternalStorageStatus> {
    await this.validatePermissions(true);
    return this.status;
  }

  async reconnectDrive(): Promise<ExternalStorageStatus> {
    await this.validatePermissions(false);
    await this.flushQueuedWrites();
    return this.status;
  }

  switchToInternalOnlyTemporarily(): void {
    this.setStatus('degraded-fallback');
    if (typeof window !== 'undefined') { window.localStorage.setItem('app.storage.provider', 'indexeddb'); }
  }

  markDegradedFallback(): void {
    this.setStatus('degraded-fallback');
  }

  async validatePermissions(requestWrite = false): Promise<ExternalStorageStatus> {
    if (!this.handle) {
      this.setStatus('permission-required');
      return this.status;
    }

    try {
      const readPermission = await this.handle.queryPermission({ mode: 'read' });
      if (readPermission !== 'granted') {
        this.setStatus('permission-required');
        return this.status;
      }

      const readWritePermission = await this.handle.queryPermission({ mode: 'readwrite' });
      if (readWritePermission !== 'granted') {
        if (requestWrite) {
          const requested = await this.handle.requestPermission({ mode: 'readwrite' });
          if (requested === 'granted') {
            this.setStatus('connected');
            return this.status;
          }
        }
        this.setStatus('read-only');
        return this.status;
      }

      const iterator = this.handle.values();
      await iterator.next();
      this.setStatus('connected');
      return this.status;
    } catch {
      this.setStatus('drive-missing');
      return this.status;
    }
  }

  async ensureWritable(): Promise<void> {
    const status = await this.validatePermissions(false);
    if (status !== 'connected') {
      throw new Error(`External storage unavailable: ${status}`);
    }
  }

  enqueueWrite(key: string, run: () => Promise<void>): void {
    this.queue = this.queue.filter((task) => task.key !== key);
    this.queue.push({ key, run });
  }

  async flushQueuedWrites(): Promise<void> {
    if (this.flushInFlight || this.queue.length === 0) return;
    if (this.status !== 'connected') return;

    this.flushInFlight = true;
    try {
      const pending = [...this.queue];
      this.queue = [];
      for (const task of pending) {
        try {
          await task.run();
        } catch {
          this.queue.push(task);
          this.setStatus('degraded-fallback');
        }
      }
      if (this.queue.length === 0 && this.status === 'degraded-fallback') {
        this.setStatus('connected');
      }
    } finally {
      this.flushInFlight = false;
    }
  }
}

export const externalStorageManager = new ExternalStorageManager();
