/**
 * P2P Message Validation using Zod
 * Protects against malformed or malicious P2P messages
 */

import { z } from 'zod';

// Gossip Protocol Validation
export const GossipPeerInfoSchema = z.object({
  peerId: z.string().min(1),
  userId: z.string().min(1),
  lastSeen: z.number().positive(),
  contentCount: z.number().int().nonnegative(),
  replicaCount: z.number().int().nonnegative().optional(),
});

export const GossipMessageSchema = z.object({
  type: z.literal('gossip_peers'),
  peers: z.array(GossipPeerInfoSchema),
  timestamp: z.number().positive(),
  ttl: z.number().int().min(0).max(10),
});

// PEX (Peer Exchange) Validation
export const PEXPeerSchema = z.object({
  peerId: z.string().min(1),
  userId: z.string().min(1),
  lastSeen: z.number().positive(),
  quality: z.number().min(0).max(1).optional(),
});

export const PEXMessageSchema = z.object({
  type: z.literal('pex'),
  peers: z.array(PEXPeerSchema),
  timestamp: z.number().positive(),
});

// Post Sync Validation
export const PostSyncRequestSchema = z.object({
  type: z.literal('post_sync_request'),
  requestId: z.string().uuid(),
  userId: z.string().min(1),
  timestamp: z.number().positive(),
});

export const PostSyncResponseSchema = z.object({
  type: z.literal('post_sync_response'),
  requestId: z.string().uuid(),
  posts: z.array(z.any()), // Post schema would be more complex
  timestamp: z.number().positive(),
});

// Comment Sync Validation
export const CommentSyncSchema = z.object({
  type: z.enum(['comment_sync_request', 'comment_sync_response', 'comment_new']),
  requestId: z.string().uuid().optional(),
  postId: z.string().optional(),
  comments: z.array(z.any()).optional(), // Comment schema would be more complex
  comment: z.any().optional(),
  timestamp: z.number().positive(),
});

// Chunk Protocol Validation
export const ChunkRequestSchema = z.object({
  type: z.literal('chunk_request'),
  requestId: z.string().uuid(),
  manifestCid: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  timestamp: z.number().positive(),
});

export const ChunkResponseSchema = z.object({
  type: z.literal('chunk_response'),
  requestId: z.string().uuid(),
  manifestCid: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  data: z.string(), // base64 encoded
  timestamp: z.number().positive(),
});

// Presence Ticket Validation
export const PresenceTicketSchema = z.object({
  peerId: z.string().min(1),
  userId: z.string().min(1),
  timestamp: z.number().positive(),
  signature: z.string().min(1),
  publicKey: z.string().min(1),
});

// Generic Message Envelope
export const P2PMessageEnvelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.any(),
  timestamp: z.number().positive(),
  from: z.string().min(1).optional(),
  signature: z.string().optional(),
});

/**
 * Validate and parse a P2P message safely
 */
export function validateP2PMessage<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = schema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMsg = `[P2P Validation] ${context || 'Message'} validation failed: ${error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      console.warn(errorMsg);
      return { success: false, error: errorMsg };
    }
    return { success: false, error: `Unknown validation error: ${String(error)}` };
  }
}

/**
 * Safe JSON.parse with validation
 */
export function safeParseJSON<T>(
  json: string,
  schema: z.ZodSchema<T>,
  context?: string
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(json);
    return validateP2PMessage(schema, parsed, context);
  } catch (error) {
    return {
      success: false,
      error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Type exports for convenience
export type GossipPeerInfo = z.infer<typeof GossipPeerInfoSchema>;
export type GossipMessage = z.infer<typeof GossipMessageSchema>;
export type PEXPeer = z.infer<typeof PEXPeerSchema>;
export type PEXMessage = z.infer<typeof PEXMessageSchema>;
export type PresenceTicket = z.infer<typeof PresenceTicketSchema>;
