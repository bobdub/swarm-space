# External Storage Recovery Runbook

_Last Updated: 2026-03-28_

## Overview

This runbook covers recovery procedures when the external storage provider encounters issues — permission revocation, device disconnection, data corruption, or quota exhaustion.

---

## Symptom: "Permission to external directory was revoked"

**Cause**: The browser lost the File System Access API permission grant (e.g., browser restart, OS-level revocation).

**Resolution**:
1. Go to **Settings → Storage**
2. Click **Disconnect** on the External Device card
3. Click **Connect External Storage** and re-select the same directory
4. The provider will restore access and resume routing bulk data

**Note**: A user gesture (click) is required to re-grant permission. The app cannot silently re-acquire it.

---

## Symptom: "No external directory connected" after browser restart

**Cause**: The stored `FileSystemDirectoryHandle` could not be restored. This is normal on Firefox/Safari (which don't support the API) or if the handle was invalidated.

**Resolution**:
1. On Chromium browsers: go to **Settings → Storage** and reconnect
2. On other browsers: use **Export Archive** / **Import Archive** for manual data portability

---

## Symptom: Scrub job reports corrupted records

**Cause**: Data on the external device was modified outside the app, or a write was interrupted (e.g., USB drive removed mid-write).

**Resolution**:
1. Check the browser console for `[ScrubJob]` warnings listing affected records
2. The `storage-scrub-corruption` custom event is dispatched — listen for it in the UI
3. Options:
   - **Re-fetch from mesh**: If peers still have the content, it will be re-downloaded on next access
   - **Delete corrupted entries**: Use the provider's `remove()` to clear bad records
   - **Restore from archive**: Import a previous archive backup

---

## Symptom: Replication skipped due to low storage

**Cause**: Both browser IndexedDB and the external device are near capacity.

**Resolution**:
1. Check **Settings → Storage** for usage percentages
2. Free space on the external device or connect a larger one
3. Adjust thresholds: `maxLocalUsagePercent` (default 80%) and `minExternalFreeBytes` (default 100 MB)
4. Consider releasing old replicas via the Node Dashboard

---

## Symptom: Data loss after external device removed

**Cause**: Bulk data (manifests, chunks) was stored exclusively on the external device, which is no longer accessible.

**Resolution**:
1. Critical data (identity, posts, keys) is always in browser IndexedDB — these are unaffected
2. Manifests and chunks stored externally can be re-fetched from the P2P mesh if peers are available
3. If no peers have the data, it may be unrecoverable — this is why **Mirror mode** (keeps a browser copy) is recommended for important content

---

## Prevention Checklist

- [ ] Use **Mirror** placement mode for important content (keeps data in both browser + external)
- [ ] Run periodic **Export Archive** backups
- [ ] Monitor the scrub job reports in the console
- [ ] Don't remove the external device while the app is actively writing
- [ ] Keep browser updated for best File System Access API support

---

## Related Documentation

- [SECURITY_MODEL.md](../SECURITY_MODEL.md) — External device threat model
- [ENCRYPTION_ARCHITECTURE.md](../ENCRYPTION_ARCHITECTURE.md) — Encryption layers
- Storage provider source: `src/lib/storage/providers/`
