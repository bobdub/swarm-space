/**
 * ═══════════════════════════════════════════════════════════════════════
 * Mesh-Inline Blockchain Recorder
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Replaces the old blockchainRecorder that used a separate chain instance.
 * All transactions now flow through the active mesh (SwarmMesh or
 * BuilderMode) so block sync happens as part of normal peer data
 * exchange — not a separate system.
 *
 * Flow:
 *   User action → recordAction() → mesh.addTransaction()
 *     → auto-mined into next block (SwarmMesh) or queued (Builder)
 *     → broadcast to peers via existing mesh channels
 *     → peers validate & append via longest-chain consensus
 *
 * Zero separate blockchain connections. Zero extra signaling.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { StandaloneSwarmMesh } from "../p2p/swarmMesh.standalone";
import type { StandaloneBuilderMode } from "../p2p/builderMode.standalone";

// ── Types ──────────────────────────────────────────────────────────────

export type MeshActionType =
  | "post_create"
  | "comment_create"
  | "reaction_add"
  | "achievement_unlock"
  | "reward_claim"
  | "credit_transfer"
  | "file_upload"
  | "profile_update";

export interface MeshActionRecord {
  txId: string;
  actionType: MeshActionType;
  userId: string;
  timestamp: number;
  meta: Record<string, unknown>;
}

type MeshInstance = StandaloneSwarmMesh | StandaloneBuilderMode;

// ── Active Mesh Reference ──────────────────────────────────────────────

let _activeMesh: MeshInstance | null = null;
const _actionLog: MeshActionRecord[] = [];
const _listeners = new Set<(record: MeshActionRecord) => void>();

/**
 * Bind the recorder to whichever mesh is currently active.
 * Call this once when the mesh starts (from P2PContext or NodeDashboard).
 */
export function bindMeshRecorder(mesh: MeshInstance): void {
  _activeMesh = mesh;
  console.log("[MeshRecorder] Bound to active mesh instance");
}

/**
 * Unbind — call on mesh shutdown.
 */
export function unbindMeshRecorder(): void {
  _activeMesh = null;
}

// ── Core: Record any action inline with the mesh ───────────────────────

export function recordAction(
  actionType: MeshActionType,
  userId: string,
  meta: Record<string, unknown> = {}
): MeshActionRecord {
  if (!_activeMesh) {
    // Queue locally if mesh isn't up yet — will be mined when mesh starts
    const record: MeshActionRecord = {
      txId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actionType,
      userId,
      timestamp: Date.now(),
      meta,
    };
    _actionLog.push(record);
    _notifyListeners(record);
    console.log(`[MeshRecorder] Queued offline: ${actionType}`, record.txId);
    return record;
  }

  // Push transaction directly into the mesh's pending pool.
  // The mesh's own mining loop (auto in SwarmMesh, manual in Builder)
  // will include it in the next block and broadcast to peers.
  const txId = _activeMesh.addTransaction(
    actionType,
    "swarm-network",
    {
      userId,
      actionType,
      ...meta,
      recordedAt: Date.now(),
    }
  );

  const record: MeshActionRecord = {
    txId,
    actionType,
    userId,
    timestamp: Date.now(),
    meta,
  };

  _actionLog.push(record);
  _notifyListeners(record);

  // Also fire DOM event for any UI listeners (wallet, activity feed)
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("mesh-blockchain-action", { detail: record })
    );
  }

  console.log(`[MeshRecorder] ⛓️ ${actionType} → mesh tx ${txId}`);
  return record;
}

// ── Flush offline queue into mesh ──────────────────────────────────────

export function flushOfflineQueue(): number {
  if (!_activeMesh) return 0;

  const offlineRecords = _actionLog.filter(r => r.txId.startsWith("offline-"));
  let flushed = 0;

  for (const rec of offlineRecords) {
    _activeMesh.addTransaction(
      rec.actionType,
      "swarm-network",
      {
        userId: rec.userId,
        actionType: rec.actionType,
        ...rec.meta,
        recordedAt: rec.timestamp,
        flushedAt: Date.now(),
      }
    );
    flushed++;
  }

  if (flushed > 0) {
    console.log(`[MeshRecorder] Flushed ${flushed} offline transactions into mesh`);
  }
  return flushed;
}

// ── Convenience methods (match old blockchainRecorder API shape) ───────

export function recordPost(postId: string, userId: string, contentPreview: string): MeshActionRecord {
  return recordAction("post_create", userId, {
    postId,
    contentPreview: contentPreview.slice(0, 100),
  });
}

export function recordComment(
  commentId: string,
  postId: string,
  userId: string,
  textPreview: string
): MeshActionRecord {
  return recordAction("comment_create", userId, {
    commentId,
    postId,
    textPreview: textPreview.slice(0, 100),
  });
}

export function recordReaction(postId: string, userId: string, emoji: string): MeshActionRecord {
  return recordAction("reaction_add", userId, { postId, emoji });
}

export function recordAchievement(
  achievementId: string,
  userId: string,
  achievementTitle: string
): MeshActionRecord {
  return recordAction("achievement_unlock", userId, {
    achievementId,
    achievementTitle,
  });
}

export function recordReward(userId: string, amount: number, reason: string): MeshActionRecord {
  return recordAction("reward_claim", userId, { amount, reason });
}

export function recordFileUpload(
  fileId: string,
  userId: string,
  fileName: string,
  sizeBytes: number
): MeshActionRecord {
  return recordAction("file_upload", userId, { fileId, fileName, sizeBytes });
}

export function recordCreditTransfer(
  fromUserId: string,
  toUserId: string,
  amount: number
): MeshActionRecord {
  return recordAction("credit_transfer", fromUserId, { toUserId, amount });
}

// ── Listeners & Query ──────────────────────────────────────────────────

export function onAction(handler: (record: MeshActionRecord) => void): () => void {
  _listeners.add(handler);
  return () => { _listeners.delete(handler); };
}

export function getActionLog(): MeshActionRecord[] {
  return [..._actionLog];
}

export function getActionsByUser(userId: string): MeshActionRecord[] {
  return _actionLog.filter(r => r.userId === userId);
}

export function getActionsByType(type: MeshActionType): MeshActionRecord[] {
  return _actionLog.filter(r => r.actionType === type);
}

function _notifyListeners(record: MeshActionRecord): void {
  for (const h of _listeners) {
    try { h(record); } catch {}
  }
}
