/**
 * Encrypted Post Sync Integration
 * Wraps PostSyncManager with multi-stage encryption protocol
 */

import { PostSyncManager, type PostSyncMessage } from "./postSync";
import type { Post } from "@/types";
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

interface EncryptedPostMessage {
  type: "encrypted_post_chunks";
  chunks: SecureChunk[];
  postId: string;
  authorPublicKey: string;
}

export class EncryptedPostSync {
  private chunkCache = new Map<string, SecureChunk[]>();
  private postSyncManager: PostSyncManager;
  private sendMessageFn: (peerId: string, message: PostSyncMessage) => boolean;
  private getConnectedPeersFn: () => string[];
  private peerId: string;

  constructor(
    sendMessage: (peerId: string, message: PostSyncMessage) => boolean,
    getConnectedPeers: () => string[],
    ensureManifests: (manifestIds: string[], sourcePeerId?: string) => Promise<void>,
    peerId: string
  ) {
    this.sendMessageFn = sendMessage;
    this.getConnectedPeersFn = getConnectedPeers;
    this.peerId = peerId;
    this.postSyncManager = new PostSyncManager(sendMessage, getConnectedPeers, ensureManifests);
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    await this.postSyncManager.handlePeerConnected(peerId);
  }

  async handleMessage(peerId: string, message: PostSyncMessage): Promise<void> {
    await this.postSyncManager.handleMessage(peerId, message);
  }

  async broadcastEncryptedPost(post: Post): Promise<void> {
    try {
      const user = getCurrentUser();
      if (!user?.publicKey) {
        throw new Error("User public key not available");
      }

      const postData = JSON.stringify({
        id: post.id,
        content: post.content,
        author: post.author,
        createdAt: post.createdAt,
        projectId: post.projectId,
        manifestCids: (post as unknown as Record<string, unknown>).manifestCids || [],
        reactions: post.reactions,
        nsfw: post.nsfw,
      });

      const encrypted = await encryptUserContent(postData, user.publicKey);

      const chunks = await chunkEncryptedContent(
        encrypted,
        this.peerId,
        "post",
        post.id
      );

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "post-encrypted",
        message: `Encrypted post ${post.id} into ${chunks.length} chunks`,
      });

      // Broadcast via standard sync (backward compatibility)
      await this.postSyncManager.broadcastPost(post);

      // Additionally broadcast encrypted chunks to peers that support it
      this.broadcastEncryptedChunks({
        type: "encrypted_post_chunks",
        chunks,
        postId: post.id,
        authorPublicKey: user.publicKey,
      });
    } catch (error) {
      console.error("[EncryptedPostSync] Failed to encrypt post:", error);
      await this.postSyncManager.broadcastPost(post);
    }
  }

  private broadcastEncryptedChunks(message: EncryptedPostMessage): void {
    const peers = this.getConnectedPeersFn();
    for (const peer of peers) {
      this.sendMessageFn(peer, message as unknown as PostSyncMessage);
    }
  }

  async handleEncryptedChunks(
    message: EncryptedPostMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, postId, authorPublicKey } = message;
      this.chunkCache.set(postId, chunks);

      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      if (chunks.length !== expectedChunks) {
        console.warn(
          `[EncryptedPostSync] Incomplete chunks for post ${postId}: ${chunks.length}/${expectedChunks}`
        );
        return;
      }

      const encryptedContent = reassembleChunks(chunks);

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "post-assembled",
        message: `Received and assembled encrypted post ${postId}`,
      });

      await this.storeEncryptedPost(postId, encryptedContent, authorPublicKey);
    } catch (error) {
      console.error("[EncryptedPostSync] Failed to handle encrypted chunks:", error);
    }
  }

  private async storeEncryptedPost(
    postId: string,
    encryptedContent: EncryptedContent,
    authorPublicKey: string
  ): Promise<void> {
    const storageKey = `encrypted_post_${postId}`;
    const data = {
      postId,
      encryptedContent,
      authorPublicKey,
      receivedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(data));
  }

  async decryptStoredPost(postId: string): Promise<Post | null> {
    try {
      const storageKey = `encrypted_post_${postId}`;
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return null;

      const { encryptedContent, authorPublicKey } = JSON.parse(stored);

      const user = getCurrentUser();
      if (!user) {
        console.warn("[EncryptedPostSync] Cannot decrypt: no user");
        return null;
      }

      const privateKey = await getCachedPrivateKey();
      if (!privateKey) {
        console.warn("[EncryptedPostSync] Cannot decrypt: no private key in vault");
        return null;
      }

      const decrypted = await decryptUserContent(encryptedContent, privateKey);
      const post = JSON.parse(decrypted);

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "post-decrypted",
        message: `Successfully decrypted post ${postId}`,
      });

      return post;
    } catch (error) {
      console.error("[EncryptedPostSync] Failed to decrypt post:", error);
      return null;
    }
  }
}
