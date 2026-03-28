

## External Storage Provider Architecture

A five-phase implementation adding a pluggable storage backend system that allows users to offload large data (manifests, chunks, replicas) to external devices via the File System Access API, while keeping critical metadata in browser IndexedDB.

---

### Phase 1 — Provider Interface and Browser Default

**New files:**

**`src/lib/storage/providers/types.ts`** — Define the `StorageProvider` contract:
```typescript
interface StorageProvider {
  id: string;
  name: string;
  // CRUD
  get<T>(store: string, key: string): Promise<T | null>;
  put<T>(store: string, key: string, data: T): Promise<void>;
  remove(store: string, key: string): Promise<void>;
  getAll<T>(store: string): Promise<T[]>;
  // Capacity
  getCapacity(): Promise<{ used: number; total: number; free: number }>;
  // Health
  isAvailable(): Promise<boolean>;
  getHealthStatus(): Promise<StorageHealthResult>;
}

type StorageTier = 'critical' | 'bulk' | 'replica';
```

**`src/lib/storage/providers/browserProvider.ts`** — Wraps existing `src/lib/store.ts` (`get`, `put`, `remove`, `getAll`, `openDB`) into the `StorageProvider` interface. Uses `navigator.storage.estimate()` for capacity. This is the default provider and preserves all current behavior.

**`src/lib/storage/providers/index.ts`** — Provider registry/factory:
- Maintains a `Map<string, StorageProvider>` of registered backends
- Exposes `getProvider(tier: StorageTier)` that returns the appropriate backend based on data classification
- Defaults to browser provider for all tiers when no external device is configured

**Refactor callers** in `src/lib/p2p/replication.ts`, `src/lib/p2p/chunkProtocol.ts`, `src/lib/p2p/discovery.ts`:
- Replace direct `import { get, put } from '../store'` with `import { getProvider } from '../storage/providers'`
- Route chunk/manifest reads and writes through `getProvider('bulk')` instead of raw IndexedDB calls
- Keep post/user/meta operations on `getProvider('critical')` (always browser)

No behavior change in this phase — browser provider handles everything.

---

### Phase 2 — External Device Provider

**`src/lib/storage/providers/externalDeviceProvider.ts`**:
- Implements `StorageProvider` using File System Access API (`window.showDirectoryPicker`, `FileSystemDirectoryHandle`)
- Directory structure: `/<root>/manifests/<id>.json`, `/<root>/chunks/<ref>.bin`
- Atomic writes: write to `.tmp` file then rename to final name
- Handle permission revalidation: on each `isAvailable()` call, check `handle.queryPermission()` and prompt if needed
- Store handle reference in IndexedDB (handles are serializable via `idb-keyval` pattern) for session restore

**`src/lib/storage/providers/capabilities.ts`**:
- Detect `window.showDirectoryPicker` support
- Classify: `full` (Chromium 86+), `fallback-only` (Firefox/Safari)
- Export `supportsExternalStorage(): boolean`

**`src/lib/storage/providers/archiveFallback.ts`**:
- For unsupported browsers: export/import data as a single zip-like bundle using `CompressionStream`
- Not a live provider — manual export/import only
- Allows users to back up chunks/manifests to a downloadable file

---

### Phase 3 — Settings UI

**`src/components/settings/StorageTargetsPanel.tsx`**:
- Shows active backend (Browser / External Device), free space bar, connect/disconnect buttons
- "Connect External Storage" button calls `showDirectoryPicker()` and registers the provider
- Default write target selector (Browser / External / Auto)
- Grayed out with explanation on unsupported browsers

Add to **`src/pages/Settings.tsx`** as a new tab or card in the existing settings layout.

**Migration actions** (buttons in the panel):
- "Move data to device" — iterates bulk stores, copies to external, removes from browser
- "Mirror to device" — copies without removing local
- "Rebuild local cache" — pulls critical subset back from device

Each action shows a progress dialog with file count, bytes transferred, and cancel button.

**Wire into `src/lib/onboarding/storageHealth.ts`**:
- Add external provider health check to `assessStorageHealth()`
- Show recovery states: permission revoked, device disconnected, path unavailable

---

### Phase 4 — Tiered Data Routing

**Data classification** (in `types.ts`):
| Tier | Stores | Target |
|---|---|---|
| `critical` | posts, users, meta, keys, sessions | Always browser IndexedDB |
| `bulk` | manifests, chunks | External when available, browser fallback |
| `replica` | replicas | External preferred, skip if no space |

**Update `src/lib/p2p/replication.ts`**:
- Before rejecting replication for low quota, check `getProvider('replica').getCapacity()`
- If external has space, accept replication there even when browser is full

**Configurable thresholds** (stored in `meta` store):
- `maxLocalUsagePercent`: default 80% — start routing bulk to external above this
- `minExternalFreeBytes`: default 100MB — stop writing to external below this
- `placementMode`: `'auto' | 'mirror' | 'external-only'`

**Placement metadata**: Each manifest record gets a `placement: { provider: string, storedAt: number }` field so reads resolve the correct backend without scanning all providers.

---

### Phase 5 — Encryption and Integrity

**Reuse `src/lib/storage/protectedStorage.ts`**:
- External provider writes call `putProtected()` so all data on device is AES-GCM encrypted with HMAC integrity
- Key material stays in browser IndexedDB only — never written to external device
- On read from external, `getProtected()` verifies HMAC before decryption

**Periodic scrub job** (`src/lib/storage/providers/scrubJob.ts`):
- Runs on app startup and every 6 hours (via `setInterval`)
- Iterates external manifests/chunks, verifies HMAC
- Reports corruption count to UI via custom event
- Offers repair: re-fetch from mesh or delete corrupted entries

**Security documentation**:
- Update `docs/SECURITY_MODEL.md` with external storage threat model
- New `docs/runbooks/external-storage-recovery.md` for operational procedures

---

### Files Created/Modified

| File | Action |
|---|---|
| `src/lib/storage/providers/types.ts` | Create — provider interface + tier types |
| `src/lib/storage/providers/browserProvider.ts` | Create — wraps existing store.ts |
| `src/lib/storage/providers/index.ts` | Create — registry/factory |
| `src/lib/storage/providers/externalDeviceProvider.ts` | Create — File System Access API |
| `src/lib/storage/providers/capabilities.ts` | Create — browser support detection |
| `src/lib/storage/providers/archiveFallback.ts` | Create — zip export/import |
| `src/lib/storage/providers/scrubJob.ts` | Create — integrity verification |
| `src/components/settings/StorageTargetsPanel.tsx` | Create — settings UI |
| `src/lib/p2p/replication.ts` | Modify — use provider interface |
| `src/lib/p2p/chunkProtocol.ts` | Modify — use provider interface |
| `src/lib/p2p/discovery.ts` | Modify — use provider interface |
| `src/lib/onboarding/storageHealth.ts` | Modify — add external health check |
| `src/pages/Settings.tsx` | Modify — add StorageTargetsPanel |
| `docs/SECURITY_MODEL.md` | Modify — external storage threat model |
| `docs/runbooks/external-storage-recovery.md` | Create — recovery procedures |

