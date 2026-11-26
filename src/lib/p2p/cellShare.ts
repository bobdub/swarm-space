/**
 * Cell invite sharing: build the link that connects a guest to both the
 * cell and the person sharing it, then copy it or hand it to the native
 * share sheet.
 */

import { toast } from 'sonner';
import { cellInviteUrl } from './brainInvite';
import { getSwarmMeshStandalone } from './swarmMesh.standalone';

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Our main-mesh peerId, when the mesh has one yet. */
function myMeshPeerId(): string | null {
  try { return getSwarmMeshStandalone().getPeerId() || null; } catch { return null; }
}

/** An invite link where we are the sharer: guests dial us and join the cell. */
export function myCellInviteUrl(cellId: string): string {
  return cellInviteUrl(origin(), cellId, myMeshPeerId());
}

/** An invite link that dials someone else (e.g. a public cell's owner). */
export function cellInviteUrlVia(cellId: string, sharerPeerId: string | null | undefined): string {
  return cellInviteUrl(origin(), cellId, sharerPeerId ?? null);
}

export const canNativeShare = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function copyCellInvite(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Cell invite link copied', { description: 'Anyone who opens it joins the cell and connects to you.' });
  } catch {
    toast.error('Could not copy the invite link.');
  }
}

/** Native share sheet when available, clipboard otherwise. */
export async function shareCellInvite(url: string, cellName: string): Promise<void> {
  if (canNativeShare()) {
    try {
      await navigator.share({ title: `Join ${cellName}`, text: `Join my cell "${cellName}" on Swarm Space`, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  await copyCellInvite(url);
}
