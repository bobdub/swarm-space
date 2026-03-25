/**
 * Recording blob persistence routed through storage provider abstraction.
 */

import {
  deleteByPlacementPolicy,
  readByPlacementPolicy,
  storeByPlacementPolicy,
} from '@/lib/storage/placementPolicy';

const RECORDING_SCOPE = 'recordings';

export interface SaveRecordingOptions {
  sensitive?: boolean;
}

export async function saveRecordingBlob(
  recordingId: string,
  blob: Blob,
  options: SaveRecordingOptions = {},
): Promise<void> {
  await storeByPlacementPolicy(RECORDING_SCOPE, recordingId, blob, {
    sensitive: options.sensitive ?? false,
    estimatedSizeBytes: blob.size,
  });
}

export async function getRecordingBlob(recordingId: string): Promise<Blob | null> {
  return readByPlacementPolicy<Blob>(RECORDING_SCOPE, recordingId);
}

export async function deleteRecordingBlob(recordingId: string): Promise<void> {
  await deleteByPlacementPolicy(RECORDING_SCOPE, recordingId);
}
