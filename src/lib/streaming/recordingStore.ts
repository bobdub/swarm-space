/**
 * Recording blob persistence routed through storage provider abstraction.
 */

import { deleteBlob, getBlob, putBlob } from '@/lib/storage/providers';

const RECORDING_SCOPE = 'recordings';

export async function saveRecordingBlob(recordingId: string, blob: Blob): Promise<void> {
  await putBlob(RECORDING_SCOPE, recordingId, blob);
}

export async function getRecordingBlob(recordingId: string): Promise<Blob | null> {
  return getBlob<Blob>(RECORDING_SCOPE, recordingId);
}

export async function deleteRecordingBlob(recordingId: string): Promise<void> {
  await deleteBlob(RECORDING_SCOPE, recordingId);
}
