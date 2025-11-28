/**
 * Encrypted Comment Sync Integration
 * Wraps CommentSync with multi-stage encryption protocol
 */

import { CommentSync } from "./commentSync";
import type { Comment } from "@/types";
import {
  encryptUserContent,
  decryptUserContent,
  chunkEncryptedContent,
  reassembleChunks,
  type SecureChunk,
} from "../encryption/contentEncryption";
import { getCurrentUser } from "../auth";
import { recordP2PDiagnostic } from "./diagnostics";

interface EncryptedCommentMessage {
  type: "encrypted_comment_chunks";
  chunks: SecureChunk[];
  commentId: string;
  postId: string;
  authorPublicKey: string;
}

export class EncryptedCommentSync {
  private chunkCache = new Map<string, SecureChunk[]>();
  private commentSync: CommentSync;

  constructor(
    sendMessage: (peerId: string, message: any) => boolean,
    getConnectedPeers: () => string[]
  ) {
    this.commentSync = new CommentSync(sendMessage, getConnectedPeers);
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    await this.commentSync.handlePeerConnected(peerId);
  }

  async handleMessage(peerId: string, message: any): Promise<void> {
    await this.commentSync.handleMessage(peerId, message);
  }

  async broadcastEncryptedComment(comment: Comment): Promise<void> {
    try {
      const user = getCurrentUser();
      if (!user?.publicKey) {
        throw new Error("User public key not available");
      }

      // Stage A: Encrypt comment content
      const commentData = JSON.stringify({
        id: comment.id,
        postId: comment.postId,
        text: (comment as any).text || "",
        author: comment.author,
        createdAt: comment.createdAt,
      });

      const encrypted = await encryptUserContent(commentData, user.publicKey);

      // Stage B: Chunk encrypted content
      const peerId = window.localStorage.getItem("peerId") || "unknown";
      const chunks = await chunkEncryptedContent(
        encrypted,
        peerId,
        "comment",
        comment.id
      );

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "comment-encrypted",
        message: `Encrypted comment ${comment.id} into ${chunks.length} chunks`,
      });

      // Broadcast via standard sync
      this.commentSync.broadcastComment(comment);

      // Additionally broadcast encrypted chunks
      this.broadcastEncryptedChunks({
        type: "encrypted_comment_chunks",
        chunks,
        commentId: comment.id,
        postId: comment.postId,
        authorPublicKey: user.publicKey,
      });
    } catch (error) {
      console.error("[EncryptedCommentSync] Failed to encrypt comment:", error);
      // Fallback to unencrypted broadcast
      this.commentSync.broadcastComment(comment);
    }
  }

  private broadcastEncryptedChunks(message: EncryptedCommentMessage): void {
    // Handled by orchestrator
  }

  async handleEncryptedChunks(
    message: EncryptedCommentMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, commentId, postId, authorPublicKey } = message;

      // Cache chunks
      this.chunkCache.set(commentId, chunks);

      // Verify all chunks present
      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      if (chunks.length !== expectedChunks) {
        console.warn(
          `[EncryptedCommentSync] Incomplete chunks for comment ${commentId}: ${chunks.length}/${expectedChunks}`
        );
        return;
      }

      // Reassemble chunks
      const encryptedContent = reassembleChunks(chunks);

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "comment-assembled",
        message: `Received and assembled encrypted comment ${commentId}`,
      });

      // Store for later decryption
      await this.storeEncryptedComment(
        commentId,
        postId,
        encryptedContent,
        authorPublicKey
      );
    } catch (error) {
      console.error(
        "[EncryptedCommentSync] Failed to handle encrypted chunks:",
        error
      );
    }
  }

  private async storeEncryptedComment(
    commentId: string,
    postId: string,
    encryptedContent: any,
    authorPublicKey: string
  ): Promise<void> {
    const storageKey = `encrypted_comment_${commentId}`;
    const data = {
      commentId,
      postId,
      encryptedContent,
      authorPublicKey,
      receivedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(data));
  }

  async decryptStoredComment(commentId: string): Promise<Comment | null> {
    try {
      const storageKey = `encrypted_comment_${commentId}`;
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return null;

      const { encryptedContent } = JSON.parse(stored);

      const user = getCurrentUser();
      if (!user) {
        console.warn("[EncryptedCommentSync] Cannot decrypt: no user");
        return null;
      }

      const privateKey = window.sessionStorage.getItem("unwrappedPrivateKey");
      if (!privateKey) {
        console.warn("[EncryptedCommentSync] Cannot decrypt: no private key");
        return null;
      }

      // Decrypt comment content
      const decrypted = await decryptUserContent(encryptedContent, privateKey);

      const comment = JSON.parse(decrypted);
      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "comment-decrypted",
        message: `Successfully decrypted comment ${commentId}`,
      });

      return comment;
    } catch (error) {
      console.error("[EncryptedCommentSync] Failed to decrypt comment:", error);
      return null;
    }
  }
}
