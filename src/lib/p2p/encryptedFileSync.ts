/**
 * Encrypted File Sync Integration
 * Handles file chunks with multi-stage encryption
 */

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

interface EncryptedFileMessage {
  type: "encrypted_file_chunks";
  chunks: SecureChunk[];
  manifestId: string;
  fileName: string;
  fileType: string;
  authorPublicKey: string;
}

export class EncryptedFileSync {
  private chunkCache = new Map<string, SecureChunk[]>();
  private sendMessageFn: (peerId: string, message: unknown) => boolean;
  private getConnectedPeersFn: () => string[];
  private peerId: string;

  constructor(
    sendMessage: (peerId: string, message: unknown) => boolean,
    getConnectedPeers: () => string[],
    peerId: string
  ) {
    this.sendMessageFn = sendMessage;
    this.getConnectedPeersFn = getConnectedPeers;
    this.peerId = peerId;
  }

  async broadcastEncryptedFile(
    fileData: ArrayBuffer,
    fileName: string,
    fileType: string,
    manifestId: string
  ): Promise<void> {
    try {
      const user = getCurrentUser();
      if (!user?.publicKey) {
        throw new Error("User public key not available");
      }

      const bytes = new Uint8Array(fileData);
      const CHUNK = 8192;
      let binaryStr = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binaryStr += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      const base64Data = btoa(binaryStr);

      const filePayload = JSON.stringify({
        fileName,
        fileType,
        data: base64Data,
        manifestId,
        uploadedAt: new Date().toISOString(),
      });

      const encrypted = await encryptUserContent(filePayload, user.publicKey);

      const chunks = await chunkEncryptedContent(
        encrypted,
        this.peerId,
        "file",
        manifestId,
        64 * 1024
      );

      recordP2PDiagnostic({
        level: "info",
        source: "replication",
        code: "file-encrypted",
        message: `Encrypted file ${fileName} into ${chunks.length} chunks`,
      });

      this.broadcastEncryptedChunks({
        type: "encrypted_file_chunks",
        chunks,
        manifestId,
        fileName,
        fileType,
        authorPublicKey: user.publicKey,
      });
    } catch (error) {
      console.error("[EncryptedFileSync] Failed to encrypt file:", error);
      throw error;
    }
  }

  private broadcastEncryptedChunks(message: EncryptedFileMessage): void {
    const peers = this.getConnectedPeersFn();
    for (const peer of peers) {
      this.sendMessageFn(peer, message);
    }
  }

  async handleEncryptedChunks(
    message: EncryptedFileMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, manifestId, fileName, fileType, authorPublicKey } = message;

      const cacheKey = `${manifestId}_${fromPeer}`;
      const existing = this.chunkCache.get(cacheKey) || [];
      this.chunkCache.set(cacheKey, [...existing, ...chunks]);

      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      const cachedChunks = this.chunkCache.get(cacheKey) || [];

      if (cachedChunks.length < expectedChunks) {
        console.debug(
          `[EncryptedFileSync] Waiting for chunks: ${cachedChunks.length}/${expectedChunks}`
        );
        return;
      }

      const encryptedContent = reassembleChunks(cachedChunks);

      recordP2PDiagnostic({
        level: "info",
        source: "replication",
        code: "file-assembled",
        message: `Received and assembled encrypted file ${fileName}`,
      });

      await this.storeEncryptedFile(manifestId, fileName, fileType, encryptedContent, authorPublicKey);
      this.chunkCache.delete(cacheKey);
    } catch (error) {
      console.error("[EncryptedFileSync] Failed to handle encrypted chunks:", error);
    }
  }

  private async storeEncryptedFile(
    manifestId: string,
    fileName: string,
    fileType: string,
    encryptedContent: EncryptedContent,
    authorPublicKey: string
  ): Promise<void> {
    const storageKey = `encrypted_file_${manifestId}`;
    const data = {
      manifestId,
      fileName,
      fileType,
      encryptedContent,
      authorPublicKey,
      receivedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(data));

    try {
      const { put } = await import("../store");
      const manifestStub = {
        fileId: manifestId,
        originalName: fileName,
        mime: fileType,
        totalSize: 0,
        chunkSize: 1_048_576,
        chunkCount: 0,
        chunks: [],
        fileKey: null,
        encryptedRemote: true,
        authorPublicKey,
        receivedAt: new Date().toISOString(),
      };
      await put("manifests", manifestStub);
      console.debug(`[EncryptedFileSync] Manifest stub written to IndexedDB: ${manifestId}`);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      }
    } catch (err) {
      console.warn("[EncryptedFileSync] Failed to write manifest stub:", err);
    }
  }

  async decryptStoredFile(manifestId: string): Promise<{
    fileName: string;
    fileType: string;
    data: ArrayBuffer;
  } | null> {
    try {
      const storageKey = `encrypted_file_${manifestId}`;
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return null;

      const { fileName, fileType, encryptedContent } = JSON.parse(stored);

      const user = getCurrentUser();
      if (!user) {
        console.warn("[EncryptedFileSync] Cannot decrypt: no user");
        return null;
      }

      const privateKey = await getCachedPrivateKey();
      if (!privateKey) {
        console.warn("[EncryptedFileSync] Cannot decrypt: no private key in vault");
        return null;
      }

      const decrypted = await decryptUserContent(encryptedContent, privateKey);
      const filePayload = JSON.parse(decrypted);

      const binary = atob(filePayload.data);
      const buffer = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
      }

      recordP2PDiagnostic({
        level: "info",
        source: "replication",
        code: "file-decrypted",
        message: `Successfully decrypted file ${fileName}`,
      });

      return { fileName, fileType, data: buffer };
    } catch (error) {
      console.error("[EncryptedFileSync] Failed to decrypt file:", error);
      return null;
    }
  }
}
