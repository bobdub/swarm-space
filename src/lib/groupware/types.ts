/**
 * GroupWare Node — shared types.
 *
 * A GroupWare Node is a mesh peer that offers one of its connected personal
 * servers to other users. Storage credentials NEVER leave the host: members
 * receive a host-signed membership record and talk to the host over the mesh.
 */

export type GroupWarePolicy = 'open' | 'approval' | 'closed';
export type GroupWareRole = 'reader' | 'writer' | 'admin';

/** Advertised by a host over the mesh. Contains no server URL or secrets. */
export interface GroupWareNodeAd {
  nodeId: string;
  hostPeerId: string;
  name: string;
  policy: GroupWarePolicy;
  /** Host ECDSA P-256 public key (JWK) used to verify memberships. */
  hostPublicKey: JsonWebKey;
  memberCount: number;
  maxMembers: number;
  ts: number;
  /** Optional public HTTPS SWARM JSON-RPC endpoint the host operates. Never a storage URL. */
  rpcUrl?: string;
}

export interface GroupWareAccessRequest {
  nodeId: string;
  requesterPeerId: string;
  displayName?: string;
  note?: string;
  ts: number;
}

export interface GroupWareMembership {
  nodeId: string;
  hostPeerId: string;
  memberPeerId: string;
  role: GroupWareRole;
  issuedAt: number;
  expiresAt: number | null;
}

export interface SignedGroupWareMembership {
  membership: GroupWareMembership;
  /** base64 ECDSA-SHA256 signature over canonical JSON of `membership`. */
  signature: string;
}

export type GroupWareDecision = 'grant' | 'pending' | 'deny';

export type GroupWareMessage =
  | { kind: 'discover' }
  | { kind: 'ad'; ad: GroupWareNodeAd }
  | { kind: 'access-request'; request: GroupWareAccessRequest }
  | { kind: 'access-grant'; signed: SignedGroupWareMembership }
  | { kind: 'access-pending'; nodeId: string }
  | { kind: 'access-deny'; nodeId: string; reason: string }
  | { kind: 'revoke'; nodeId: string }
  | { kind: 'relay'; nodeId: string; reqId: string; signed: SignedGroupWareMembership; op: string; args?: unknown }
  | { kind: 'relay-result'; reqId: string; ok: boolean; result?: unknown; error?: string };

export const GROUPWARE_CHANNEL = 'groupware';
export const GROUPWARE_HOST_ROLE = 'groupware-host';
