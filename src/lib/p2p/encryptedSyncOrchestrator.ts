/**
 * Encrypted Sync Orchestrator
 * Coordinates all encrypted P2P sync operations
 */

import { EncryptedPostSync } from "./encryptedPostSync";
import { EncryptedCommentSync } from "./encryptedCommentSync";
import { EncryptedFileSync } from "./encryptedFileSync";
import type { Post, Comment } from "@/types";
import { recordP2PDiagnostic } from "./diagnostics";

export class EncryptedSyncOrchestrator {
  private postSync: EncryptedPostSync | null = null;
  private commentSync: EncryptedCommentSync | null = null;
  private fileSync: EncryptedFileSync | null = null;

  /**
   * Initialize encrypted sync managers
   */
  initialize(
    sendMessage: (peerId: string, message: any) => boolean,
    getConnectedPeers: () => string[],
    ensureManifests: (manifestIds: string[], sourcePeerId?: string) => Promise<void>
  ): void {
    this.postSync = new EncryptedPostSync(
      sendMessage,
      getConnectedPeers,
      ensureManifests
    );

    this.commentSync = new EncryptedCommentSync(
      sendMessage,
      getConnectedPeers
    );

    this.fileSync = new EncryptedFileSync(sendMessage, getConnectedPeers);

    recordP2PDiagnostic({
      level: "info",
      source: "manager",
      code: "encrypted-sync-init",
      message: "Encrypted sync orchestrator initialized",
    });
  }

  /**
   * Handle incoming P2P messages and route to appropriate encrypted sync manager
   */
  async handleMessage(peerId: string, message: any): Promise<boolean> {
    try {
      switch (message.type) {
        case "encrypted_post_chunks":
          if (this.postSync) {
            await this.postSync.handleEncryptedChunks(message, peerId);
            return true;
          }
          break;

        case "encrypted_comment_chunks":
          if (this.commentSync) {
            await this.commentSync.handleEncryptedChunks(message, peerId);
            return true;
          }
          break;

        case "encrypted_file_chunks":
          if (this.fileSync) {
            await this.fileSync.handleEncryptedChunks(message, peerId);
            return true;
          }
          break;

        // Standard sync messages (for backward compatibility)
        case "posts_request":
        case "posts_sync":
        case "post_created":
          if (this.postSync) {
            await this.postSync.handleMessage(peerId, message);
            return true;
          }
          break;

        case "comments_request":
        case "comments_sync":
        case "comment_created":
          if (this.commentSync) {
            await this.commentSync.handleMessage(peerId, message);
            return true;
          }
          break;
      }

      return false;
    } catch (error) {
      console.error("[EncryptedSyncOrchestrator] Error handling message:", error);
      return false;
    }
  }

  /**
   * Broadcast post with encryption
   */
  async broadcastPost(post: Post): Promise<void> {
    if (!this.postSync) {
      throw new Error("Post sync not initialized");
    }
    await this.postSync.broadcastEncryptedPost(post);
  }

  /**
   * Broadcast comment with encryption
   */
  async broadcastComment(comment: Comment): Promise<void> {
    if (!this.commentSync) {
      throw new Error("Comment sync not initialized");
    }
    await this.commentSync.broadcastEncryptedComment(comment);
  }

  /**
   * Broadcast file with encryption
   */
  async broadcastFile(
    fileData: ArrayBuffer,
    fileName: string,
    fileType: string,
    manifestId: string
  ): Promise<void> {
    if (!this.fileSync) {
      throw new Error("File sync not initialized");
    }
    await this.fileSync.broadcastEncryptedFile(
      fileData,
      fileName,
      fileType,
      manifestId
    );
  }

  /**
   * Handle new peer connection
   */
  async handlePeerConnected(peerId: string): Promise<void> {
    if (this.postSync) {
      await this.postSync.handlePeerConnected(peerId);
    }
    if (this.commentSync) {
      await this.commentSync.handlePeerConnected(peerId);
    }
  }

  /**
   * Decrypt stored post
   */
  async decryptPost(postId: string): Promise<Post | null> {
    if (!this.postSync) return null;
    return this.postSync.decryptStoredPost(postId);
  }

  /**
   * Decrypt stored comment
   */
  async decryptComment(commentId: string): Promise<Comment | null> {
    if (!this.commentSync) return null;
    return this.commentSync.decryptStoredComment(commentId);
  }

  /**
   * Decrypt stored file
   */
  async decryptFile(manifestId: string): Promise<{
    fileName: string;
    fileType: string;
    data: ArrayBuffer;
  } | null> {
    if (!this.fileSync) return null;
    return this.fileSync.decryptStoredFile(manifestId);
  }
}

// Global instance
let orchestrator: EncryptedSyncOrchestrator | null = null;

export function getEncryptedSyncOrchestrator(): EncryptedSyncOrchestrator {
  if (!orchestrator) {
    orchestrator = new EncryptedSyncOrchestrator();
  }
  return orchestrator;
}
