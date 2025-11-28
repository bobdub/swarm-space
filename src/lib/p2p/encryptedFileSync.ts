/**
 * Encrypted File Sync Integration
 * Handles file chunks with multi-stage encryption
 */

import {
  encryptUserContent,
  decryptUserContent,
  chunkEncryptedContent,
  reassembleChunks,
  encryptForBlockchain,
  decryptFromBlockchain,
  type SecureChunk,
  type BlockchainEncryptedChunk,
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
  private sendMessageFn: (peerId: string, message: any) => boolean;
  private getConnectedPeersFn: () => string[];

  constructor(
    sendMessage: (peerId: string, message: any) => boolean,
    getConnectedPeers: () => string[]
  ) {
    this.sendMessageFn = sendMessage;
    this.getConnectedPeersFn = getConnectedPeers;
  }

  /**
   * Encrypt and broadcast file to P2P mesh
   */
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

      // Convert file to base64
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(fileData))
      );

      // Stage A: Encrypt file data
      const filePayload = JSON.stringify({
        fileName,
        fileType,
        data: base64Data,
        manifestId,
        uploadedAt: new Date().toISOString(),
      });

      const encrypted = await encryptUserContent(filePayload, user.publicKey);

      // Stage B: Chunk encrypted file
      const peerId = window.localStorage.getItem("peerId") || "unknown";
      const chunks = await chunkEncryptedContent(
        encrypted,
        peerId,
        "file",
        manifestId,
        64 * 1024 // 64KB chunks for files
      );

      // Stage C: Blockchain-encrypt chunks
      const blockchainChunks = await Promise.all(
        chunks.map((chunk) => encryptForBlockchain(chunk))
      );

      recordP2PDiagnostic({
        level: "info",
        source: "replication",
        code: "file-encrypted",
        message: `Encrypted file ${fileName} into ${chunks.length} chunks`,
      });

      // Broadcast encrypted chunks
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
    peers.forEach((peerId) => {
      this.sendMessageFn(peerId, message);
    });
  }

  /**
   * Handle incoming encrypted file chunks
   */
  async handleEncryptedChunks(
    message: EncryptedFileMessage,
    fromPeer: string
  ): Promise<void> {
    try {
      const { chunks, manifestId, fileName, fileType, authorPublicKey } =
        message;

      // Cache chunks
      const cacheKey = `${manifestId}_${fromPeer}`;
      const existing = this.chunkCache.get(cacheKey) || [];
      this.chunkCache.set(cacheKey, [...existing, ...chunks]);

      // Check if we have all chunks
      const expectedChunks = chunks[0]?.metadata.totalChunks || 0;
      const cachedChunks = this.chunkCache.get(cacheKey) || [];

      if (cachedChunks.length < expectedChunks) {
        console.log(
          `[EncryptedFileSync] Waiting for chunks: ${cachedChunks.length}/${expectedChunks}`
        );
        return;
      }

      // All chunks received, reassemble
      const encryptedContent = reassembleChunks(cachedChunks);

      recordP2PDiagnostic({
        level: "info",
        source: "replication",
        code: "file-assembled",
        message: `Received and assembled encrypted file ${fileName}`,
      });

      // Store encrypted file
      await this.storeEncryptedFile(
        manifestId,
        fileName,
        fileType,
        encryptedContent,
        authorPublicKey
      );

      // Clean up cache
      this.chunkCache.delete(cacheKey);
    } catch (error) {
      console.error(
        "[EncryptedFileSync] Failed to handle encrypted chunks:",
        error
      );
    }
  }

  private async storeEncryptedFile(
    manifestId: string,
    fileName: string,
    fileType: string,
    encryptedContent: any,
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
  }

  /**
   * Decrypt and retrieve stored file
   */
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

      const privateKey = window.sessionStorage.getItem("unwrappedPrivateKey");
      if (!privateKey) {
        console.warn("[EncryptedFileSync] Cannot decrypt: no private key");
        return null;
      }

      // Decrypt file content
      const decrypted = await decryptUserContent(encryptedContent, privateKey);

      const filePayload = JSON.parse(decrypted);

      // Convert base64 back to ArrayBuffer
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

      return {
        fileName,
        fileType,
        data: buffer,
      };
    } catch (error) {
      console.error("[EncryptedFileSync] Failed to decrypt file:", error);
      return null;
    }
  }
}
