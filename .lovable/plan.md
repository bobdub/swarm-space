

## Fix: Locally Uploaded Images Show "Syncing" Instead of Rendering

### Root Cause

The console shows `DataError: Data provided to an operation does not meet requirements` on `importKeyRaw`. This is a **key format mismatch**, not a sync issue.

Since the SEC-002 security update, file keys are stored **wrapped** (AES-GCM encrypted with a passphrase-derived key). The manifest now has `fileKeyWrapped`, `fileKeySalt`, and `fileKeyIv` fields. However, every component still calls `importKeyRaw(manifest.fileKey)` directly — which tries to import the wrapped ciphertext as a raw AES key and fails with `DataError`.

There is already a correct function `importFileKey(manifest)` in `fileEncryption.ts` (line 111) that handles both wrapped and legacy raw keys. **No component uses it.**

When decryption fails, the manifest is pushed into `pendingManifestIds`, which triggers the "Syncing across the mesh..." spinner — making it look like a network issue when the data is already local.

### Fix

Replace all `importKeyRaw(manifest.fileKey)` calls with `importFileKey(manifest)` across every component and utility that decrypts files. Also show a distinct error state when decryption fails on a local manifest (all chunks present) vs genuinely missing data.

### Files to Change

| File | Line | Change |
|------|------|--------|
| `src/components/PostCard.tsx` | ~273 | `importKeyRaw(manifest.fileKey)` → `importFileKey(manifest)` |
| `src/components/PostCard.tsx` | ~286-290 | On decrypt error for a manifest that has chunks, set a `decryptError` state instead of adding to `pendingManifestIds` — show "Decryption failed" not "Syncing" |
| `src/components/FilePreview.tsx` | ~33 | `importKeyRaw(manifest.fileKey)` → `importFileKey(manifest)` |
| `src/components/ProfileEditor.tsx` | ~53 | Same replacement |
| `src/pages/Profile.tsx` | ~709 | Same replacement |
| `src/pages/ProjectDetail.tsx` | ~140 | Same replacement |
| `src/pages/ProjectSettings.tsx` | ~77 | Same replacement |
| `src/lib/blogging/heroMedia.ts` | ~59 | Same replacement |
| `src/lib/torrent/streamingDecryptor.ts` | ~91, ~201 | Same replacement (pass full manifest) |

### UI Change in PostCard

When a manifest has `fileKey` + `chunks` but decryption throws, show:
```
"Unable to decrypt — tap to retry"
```
instead of the misleading "Syncing across the mesh..." spinner. Only show the sync spinner when chunks are genuinely missing.

### Technical Detail

```text
CURRENT (broken):
  Upload → encrypt file → store manifest with wrapped key
  Render → importKeyRaw(wrappedCiphertext) → DataError
  → pushed to pendingManifestIds → "Syncing across the mesh…" ❌

FIXED:
  Render → importFileKey(manifest) → detects wrapped format → unwraps → imports
  → decrypts blob → renders immediately ✅
  
  If unwrap fails (wrong passphrase/corrupt):
  → "Decryption failed" error state (not sync spinner) ✅
```

