// P2P Comment Sync
import { getAll, getAllByIndex, put } from "../store";
import type { Comment } from "@/types";

type CommentSyncMessageType = "comments_request" | "comments_sync" | "comment_created";

export interface CommentSyncMessage {
  type: CommentSyncMessageType;
  comments?: Comment[];
  comment?: Comment;
  postId?: string;
}

type SendMessageFn = (peerId: string, message: CommentSyncMessage) => boolean;
type ConnectedPeersFn = () => string[];

export class CommentSync {
  private readonly messageTypes: Set<CommentSyncMessageType> = new Set([
    "comments_request",
    "comments_sync",
    "comment_created"
  ]);

  constructor(
    private readonly sendMessage: SendMessageFn,
    private readonly getConnectedPeers: ConnectedPeersFn
  ) {}

  isCommentSyncMessage(message: unknown): message is CommentSyncMessage {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      this.messageTypes.has((message as { type: string }).type as CommentSyncMessageType)
    );
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    await this.sendAllCommentsToPeer(peerId);
    this.sendMessage(peerId, { type: "comments_request" });
  }

  async handleMessage(peerId: string, message: CommentSyncMessage): Promise<void> {
    switch (message.type) {
      case "comments_request":
        await this.sendAllCommentsToPeer(peerId);
        break;
      case "comments_sync":
        if (Array.isArray(message.comments) && message.comments.length > 0) {
          await this.saveIncomingComments(message.comments);
        }
        break;
      case "comment_created":
        if (message.comment) {
          await this.saveIncomingComments([message.comment]);
        }
        break;
    }
  }

  /**
   * Broadcast a new comment to all connected peers
   */
  broadcastComment(comment: Comment): void {
    const peers = this.getConnectedPeers();
    if (peers.length === 0) return;

    console.log(`[CommentSync] Broadcasting comment ${comment.id} to ${peers.length} peer(s)`);

    peers.forEach((peerId) => {
      const sent = this.sendMessage(peerId, {
        type: "comment_created",
        comment
      });

      if (!sent) {
        console.warn(`[CommentSync] Failed to broadcast comment ${comment.id} to ${peerId}`);
      }
    });
  }

  private async sendAllCommentsToPeer(peerId: string): Promise<void> {
    try {
      const comments = await getAll<Comment>("comments");
      if (comments.length === 0) return;

      const sent = this.sendMessage(peerId, {
        type: "comments_sync",
        comments
      });

      if (!sent) {
        console.warn(`[CommentSync] Failed to send comments to ${peerId}`);
      } else {
        console.log(`[CommentSync] Sent ${comments.length} comments to ${peerId}`);
      }
    } catch (error) {
      console.error("[CommentSync] Error sending comments to peer:", error);
    }
  }

  private async saveIncomingComments(comments: Comment[]): Promise<void> {
    let updatedCount = 0;

    for (const comment of comments) {
      try {
        const changed = await this.upsertComment(comment);
        if (changed) {
          updatedCount++;
        }
      } catch (error) {
        console.error(`[CommentSync] Failed to store comment ${comment.id}:`, error);
      }
    }

    if (updatedCount > 0) {
      console.log(`[CommentSync] Saved ${updatedCount} new/updated comment(s)`);
      window.dispatchEvent(new CustomEvent("p2p-comments-updated"));
    }
  }

  private async upsertComment(comment: Comment): Promise<boolean> {
    try {
      // Check if comment already exists
      const existing = await getAllByIndex<Comment>("comments", "postId", comment.postId);
      const found = existing.find(c => c.id === comment.id);

      if (!found) {
        // New comment - save it
        await put("comments", comment);
        console.log(`[CommentSync] New comment: ${comment.id}`);
        return true;
      }

      // Comment exists - check if we need to update
      const existingTime = new Date(found.createdAt).getTime();
      const incomingTime = new Date(comment.createdAt).getTime();

      if (incomingTime > existingTime || JSON.stringify(found) !== JSON.stringify(comment)) {
        await put("comments", comment);
        console.log(`[CommentSync] Updated comment: ${comment.id}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[CommentSync] Error upserting comment ${comment.id}:`, error);
      return false;
    }
  }
}
