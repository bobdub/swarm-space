/**
 * Encrypted Post Sync Integration
 * Wraps PostSyncManager with multi-stage encryption protocol
 */

import { PostSyncManager } from "./postSync";
import type { Post, Project } from "@/types";
import { getCachedPrivateKey } from "@/lib/auth";
import {
  encryptUserContent,
  decryptUserContent,
  chunkEncryptedContent,
  reassembleChunks,
  type SecureChunk,
} from "../encryption/contentEncryption";
import { getCurrentUser } from "../auth";
import { recordP2PDiagnostic } from "./diagnostics";

interface EncryptedPostMessage {
  type: "encrypted_post_chunks";
  chunks: SecureChunk[];
  postId: string;
  authorPublicKey: string;
}

type SyncMessage = EncryptedPostMessage | { type: string; [key: string]: unknown };

export class EncryptedPostSync {
  private chunkCache = new Map<string, SecureChunk[]>();
  private postSyncManager: PostSyncManager;
  private sendMessageFn: (peerId: string, message: SyncMessage) => boolean;
  private getConnectedPeersFn: () => string[];
  private peerId: string;

  constructor(
    sendMessage: (peerId: string, message: SyncMessage) => boolean,
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

  async handleMessage(peerId: string, message: SyncMessage): Promise<void> {
    await this.postSyncManager.handleMessage(peerId, message);
  }

  async broadcastEncryptedPost(post: Post): Promise<void> {
    try {
      const user = getCurrentUser();
      if (!user?.publicKey) {
        throw new Error("User public key not available");
      }

      // Stage A: Encrypt post content with creator's public key
      const postData = JSON.stringify({
        id: post.id,
        content: post.content,
        author: post.author,
        createdAt: post.createdAt,
        projectId: post.projectId,
        manifestCids: (post as Record<string, unknown>).manifestCids || [],
        reactions: post.reactions,
        nsfw: post.nsfw,
      });

      const encrypted = await encryptUserContent(postData, user.publicKey);

      // Stage B: Chunk encrypted content using actual peer identity
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

      // Broadcast via standard sync (to maintain compatibility)
      await this.postSyncManager.broadcastPost(post);

      // Additionally broadcast encrypted chunks for peers that support it
      this.broadcastEncryptedChunks({
        type: "encrypted_post_chunks",
        chunks,
        postId: post.id,
        authorPublicKey: user.publicKey,
      });
    } catch (error) {
      console.error("[EncryptedPostSync] Failed to encrypt post:", error);
      // Fallback to unencrypted broadcast
      await this.postSyncManager.broadcastPost(post);
    }
  }

  private broadcastEncryptedChunks(message: EncryptedPostMessage): void {
    const peers = this.getConnectedPeersFn();
    for (const peer of peers) {
      this.sendMessageFn(peer, message);
    }
  }

  async handleEncryptedChunks(
    message: EncryptedPostMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, postId, authorPublicKey } = message;

      // Cache chunks for this post
      this.chunkCache.set(postId, chunks);

      // Verify all chunks are present
      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      if (chunks.length !== expectedChunks) {
        console.warn(
          `[EncryptedPostSync] Incomplete chunks for post ${postId}: ${chunks.length}/${expectedChunks}`
        );
        return;
      }

      // Reassemble chunks (blockchain layer is handled at broadcast time)
      const encryptedContent = reassembleChunks(chunks);

      recordP2PDiagnostic({
        level: "info",
        source: "post-sync",
        code: "post-assembled",
        message: `Received and assembled encrypted post ${postId}`,
      });

      // Store chunks for later decryption when user has access
      await this.storeEncryptedPost(postId, encryptedContent, authorPublicKey);
    } catch (error) {
      console.error(
        "[EncryptedPostSync] Failed to handle encrypted chunks:",
        error
      );
    }
  }

  private async storeEncryptedPost(
    postId: string,
    encryptedContent: string,
    authorPublicKey: string
  ): Promise<void> {
    // Store encrypted post in protected storage
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

      // Get private key from session
      const privateKey = await getCachedPrivateKey();
      if (!privateKey) {
        console.warn("[EncryptedPostSync] Cannot decrypt: no private key in vault");
        return null;
      }

      // Stage A: Decrypt user content
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
