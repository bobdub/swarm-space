/**
 * Encrypted Comment Sync Integration
 * Wraps CommentSync with multi-stage encryption protocol
 */

import { CommentSync, type CommentSyncMessage } from "./commentSync";
import type { Comment } from "@/types";
import { getCachedPrivateKey } from "@/lib/auth";
import {
  encryptUserContent,
  decryptUserContent,
  chunkEncryptedContent,
  reassembleChunks,
  type SecureChunk,
  type EncryptedContent,
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
  private sendMessageFn: (peerId: string, message: CommentSyncMessage) => boolean;
  private getConnectedPeersFn: () => string[];
  private peerId: string;

  constructor(
    sendMessage: (peerId: string, message: CommentSyncMessage) => boolean,
    getConnectedPeers: () => string[],
    peerId: string
  ) {
    this.sendMessageFn = sendMessage;
    this.getConnectedPeersFn = getConnectedPeers;
    this.peerId = peerId;
    this.commentSync = new CommentSync(sendMessage, getConnectedPeers);
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    await this.commentSync.handlePeerConnected(peerId);
  }

  async handleMessage(peerId: string, message: CommentSyncMessage): Promise<void> {
    await this.commentSync.handleMessage(peerId, message);
  }

  async broadcastEncryptedComment(comment: Comment): Promise<void> {
    try {
      const user = getCurrentUser();
      if (!user?.publicKey) {
        throw new Error("User public key not available");
      }

      const commentData = JSON.stringify({
        id: comment.id,
        postId: comment.postId,
        text: comment.text ?? "",
        author: comment.author,
        createdAt: comment.createdAt,
      });

      const encrypted = await encryptUserContent(commentData, user.publicKey);

      const chunks = await chunkEncryptedContent(
        encrypted,
        this.peerId,
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
      this.commentSync.broadcastComment(comment);
    }
  }

  private broadcastEncryptedChunks(message: EncryptedCommentMessage): void {
    const peers = this.getConnectedPeersFn();
    for (const peer of peers) {
      this.sendMessageFn(peer, message as unknown as CommentSyncMessage);
    }
  }

  async handleEncryptedChunks(
    message: EncryptedCommentMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, commentId, postId, authorPublicKey } = message;
      this.chunkCache.set(commentId, chunks);

      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      if (chunks.length !== expectedChunks) {
        console.warn(
          `[EncryptedCommentSync] Incomplete chunks for comment ${commentId}: ${chunks.length}/${expectedChunks}`
        );
        return;
      }

      const encryptedContent = reassembleChunks(chunks);

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "comment-assembled",
        message: `Received and assembled encrypted comment ${commentId}`,
      });

      await this.storeEncryptedComment(commentId, postId, encryptedContent, authorPublicKey);
    } catch (error) {
      console.error("[EncryptedCommentSync] Failed to handle encrypted chunks:", error);
    }
  }

  private async storeEncryptedComment(
    commentId: string,
    postId: string,
    encryptedContent: EncryptedContent,
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

      const privateKey = await getCachedPrivateKey();
      if (!privateKey) {
        console.warn("[EncryptedCommentSync] Cannot decrypt: no private key in vault");
        return null;
      }

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
