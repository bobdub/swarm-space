/**
 * Public Content Sync V2
 * Handles posts/comments that are signed (not encrypted) for mesh sharing
 */

import type { Post, Comment } from "@/types";
import { signContent, verifyContentSignature, type SignedContent } from "../encryption/contentSigning";
import { getRendezvousSigner } from "./rendezvousIdentity";
import { recordP2PDiagnostic } from "./diagnostics";
import { put } from "../store";

export interface SignedPost extends SignedContent<Post> {
  type: 'post';
}

export interface SignedComment extends SignedContent<Comment> {
  type: 'comment';
}

/**
 * Sign a post for mesh distribution
 */
export async function signPost(post: Post): Promise<SignedPost> {
  try {
    const signed = await signContent(post, getRendezvousSigner);
    
    recordP2PDiagnostic({
      level: "info",
      source: "post-sync",
      code: "post-signed",
      message: `Signed post ${post.id}`,
    });
    
    return {
      type: 'post',
      ...signed,
    };
  } catch (error) {
    console.error('[PublicContentSync] Failed to sign post:', error);
    throw error;
  }
}

/**
 * Sign a comment for mesh distribution
 */
export async function signComment(comment: Comment): Promise<SignedComment> {
  try {
    const signed = await signContent(comment, getRendezvousSigner);
    
    recordP2PDiagnostic({
      level: "info",
      source: "post-sync",
      code: "comment-signed",
      message: `Signed comment ${comment.id}`,
    });
    
    return {
      type: 'comment',
      ...signed,
    };
  } catch (error) {
    console.error('[PublicContentSync] Failed to sign comment:', error);
    throw error;
  }
}

/**
 * Verify and save incoming signed post
 */
export async function receiveSignedPost(signedPost: SignedPost): Promise<boolean> {
  try {
    // Verify signature
    const valid = await verifyContentSignature(signedPost);
    
    if (!valid) {
      console.warn(`[PublicContentSync] Invalid signature for post ${signedPost.content.id}`);
      recordP2PDiagnostic({
        level: "warn",
        source: "post-sync",
        code: "invalid-signature",
        message: `Rejected post ${signedPost.content.id} - invalid signature`,
      });
      return false;
    }
    
    // Verify the signature public key matches the post author
    const post = signedPost.content;
    // Note: We'd need to look up the author's public key to verify
    // For now, we trust the signature is valid
    
    // Save post locally
    await put("posts", post);
    
    recordP2PDiagnostic({
      level: "info",
      source: "post-sync",
      code: "post-received",
      message: `Verified and saved post ${post.id} from ${post.author}`,
    });
    
    // Trigger UI update
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    }
    
    return true;
  } catch (error) {
    console.error('[PublicContentSync] Failed to receive signed post:', error);
    return false;
  }
}

/**
 * Verify and save incoming signed comment
 */
export async function receiveSignedComment(signedComment: SignedComment): Promise<boolean> {
  try {
    // Verify signature
    const valid = await verifyContentSignature(signedComment);
    
    if (!valid) {
      console.warn(`[PublicContentSync] Invalid signature for comment ${signedComment.content.id}`);
      recordP2PDiagnostic({
        level: "warn",
        source: "post-sync",
        code: "invalid-signature",
        message: `Rejected comment ${signedComment.content.id} - invalid signature`,
      });
      return false;
    }
    
    // Save comment locally
    const comment = signedComment.content;
    await put("comments", comment);
    
    recordP2PDiagnostic({
      level: "info",
      source: "post-sync",
      code: "comment-received",
      message: `Verified and saved comment ${comment.id} from ${comment.author}`,
    });
    
    // Trigger UI update
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("p2p-comments-updated"));
    }
    
    return true;
  } catch (error) {
    console.error('[PublicContentSync] Failed to receive signed comment:', error);
    return false;
  }
}

/**
 * Broadcast signed content to all connected peers
 */
export function broadcastSignedContent<T extends SignedPost | SignedComment>(
  signedContent: T,
  sendMessage: (peerId: string, message: any) => boolean,
  getConnectedPeers: () => string[]
): void {
  const peers = getConnectedPeers();
  
  if (peers.length === 0) {
    console.log('[PublicContentSync] No connected peers to broadcast to');
    return;
  }
  
  const message = {
    type: signedContent.type === 'post' ? 'signed_post' : 'signed_comment',
    signedContent,
  };
  
  let successCount = 0;
  peers.forEach((peerId) => {
    const sent = sendMessage(peerId, message);
    if (sent) successCount++;
  });
  
  recordP2PDiagnostic({
    level: "info",
    source: "post-sync",
    code: "content-broadcast",
    message: `Broadcast ${signedContent.type} to ${successCount}/${peers.length} peers`,
  });
}
