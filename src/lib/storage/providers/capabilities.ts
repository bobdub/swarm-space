/**
 * Storage Capability Detection
 * Determines which storage backends the current browser supports.
 */

export type StorageCapabilityLevel = 'full' | 'fallback-only' | 'none';

/**
 * Check whether the File System Access API is available (Chromium 86+).
 */
export function supportsExternalStorage(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as any).showDirectoryPicker === 'function';
}

/**
 * Classify the current browser's external-storage capability.
 */
export function getCapabilityLevel(): StorageCapabilityLevel {
  if (supportsExternalStorage()) return 'full';
  // Firefox/Safari can still use archive fallback (zip export/import)
  if (typeof window !== 'undefined' && typeof Blob !== 'undefined') return 'fallback-only';
  return 'none';
}

/**
 * Friendly label for the capability level.
 */
export function getCapabilityLabel(level: StorageCapabilityLevel): string {
  switch (level) {
    case 'full':
      return 'Full external storage support';
    case 'fallback-only':
      return 'Archive export/import only (external storage requires Chromium-based browser)';
    case 'none':
      return 'No external storage support';
  }
}
