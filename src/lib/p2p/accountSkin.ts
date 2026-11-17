import { affinityScore } from './connectionAffinity';
import { isPublicWalletAddress, verifyNamespaceIdentity } from '@/lib/uqrc/namespaceIdentity';

/**
 * Account Skin Protocol
 *
 * The "Skin" is the outermost organism of the mesh — the membrane where
 * user accounts (identities) touch the P2P network (peers).
 *
 * It maintains a live directory of account↔peerId bindings and propagates
 * them across the swarm so any node can resolve "which peer hosts account X?"
 *
 * Skin Surface:
 *   account-bind    — broadcast when a peer confirms its account identity
 *   account-query   — request: "who hosts userId X?"
 *   account-resolve — response: "userId X is on peerId Y"
 *   account-digest  — periodic bulk sync of the full directory
 *
 * The Skin ensures accounts are never orphaned — even after peer ID rotation
 * or reconnection, every node in the mesh can locate any known account.
 */

export interface AccountBinding {
  userId: string;
  peerId: string;
  /** Human-readable handle (e.g. "alice"). Optional — older peers may not include it. */
  username?: string;
  displayName?: string;
  avatarRef?: string;
  walletAddress?: string;
  namespaceId?: string;
  discriminator?: string;
  boundAt: number;
  /** How many hops this binding has traveled (prevents infinite propagation) */
  ttl: number;
}

export interface AccountSkinMessage {
  type: 'account-bind' | 'account-query' | 'account-resolve' | 'account-digest';
  bindings?: AccountBinding[];
  queryUserId?: string;
  /** Query by username (resolved server-side via secondary index). */
  queryUsername?: string;
  timestamp: number;
}

const MAX_TTL = 4;
const STALE_MS = 1000 * 60 * 15; // 15 minutes without update = stale
const MAX_DIRECTORY_SIZE = 500;

export class AccountSkinProtocol {
  /** userId → latest binding */
  private directory = new Map<string, AccountBinding>();
  /** username (lowercased) → userId — secondary index, kept in sync with directory */
  private usernameIndex = new Map<string, Set<string>>();
  private localUserId: string;
  private localPeerId: string | null = null;
  private localUsername: string | null = null;
  private sendToPeer: (peerId: string, type: string, payload: unknown) => boolean;
  private broadcast: (type: string, payload: unknown) => void;
  private onBindingResolved?: (binding: AccountBinding) => void;

  constructor(
    localUserId: string,
    sendToPeer: (peerId: string, type: string, payload: unknown) => boolean,
    broadcast: (type: string, payload: unknown) => void,
    onBindingResolved?: (binding: AccountBinding) => void
  ) {
    this.localUserId = localUserId;
    this.sendToPeer = sendToPeer;
    this.broadcast = broadcast;
    this.onBindingResolved = onBindingResolved;
  }

  /** Set the local peer ID once PeerJS initializes */
  setLocalPeerId(peerId: string): void {
    this.localPeerId = peerId;
    this.bindAccount(this.localUserId, peerId, { username: this.localUsername ?? undefined });
  }

  /** Set the local username so it propagates with every announce/bind. */
  setLocalUsername(username: string | null): void {
    this.localUsername = username && username.trim() ? username.trim() : null;
    if (this.localPeerId) {
      this.bindAccount(this.localUserId, this.localPeerId, { username: this.localUsername ?? undefined });
    }
  }

  /** Register an account↔peer binding (local or received from network) */
  bindAccount(
    userId: string,
    peerId: string,
    options?: { username?: string; displayName?: string; avatarRef?: string; walletAddress?: string; namespaceId?: string; discriminator?: string; ttl?: number }
  ): void {
    const existing = this.directory.get(userId);
    const now = Date.now();
    const ttl = options?.ttl ?? MAX_TTL;

    // Only update if newer or different peerId/username
    const sameUsername = (options?.username ?? existing?.username) === existing?.username;
    if (existing && existing.peerId === peerId && sameUsername && !options?.walletAddress && !options?.displayName && !options?.avatarRef && now - existing.boundAt < 5000) {
      return; // Debounce duplicate bindings
    }

    const walletChanged = !!options?.walletAddress && options.walletAddress.toLowerCase() !== existing?.walletAddress?.toLowerCase();
    const binding: AccountBinding = {
      userId,
      peerId,
      username: options?.username ?? existing?.username,
      displayName: options?.displayName ?? existing?.displayName,
      avatarRef: options?.avatarRef ?? existing?.avatarRef,
      walletAddress: options?.walletAddress ?? existing?.walletAddress,
      // A new wallet anchor invalidates coordinates derived from the old one.
      namespaceId: options?.namespaceId ?? (walletChanged ? undefined : existing?.namespaceId),
      discriminator: options?.discriminator ?? (walletChanged ? undefined : existing?.discriminator),
      boundAt: now,
      ttl,
    };

    if (existing?.username) this.removeUsername(existing.username, userId);
    this.directory.set(userId, binding);
    if (binding.username) {
      this.indexUsername(binding.username, userId);
    }
    this.evictStaleEntries();

    if (this.onBindingResolved) {
      try {
        this.onBindingResolved(binding);
      } catch (err) {
        console.warn('[Skin] Binding callback threw', err);
      }
    }
  }

  /** Announce our own account binding to the mesh */
  announceBinding(displayName?: string, avatarRef?: string): void {
    if (!this.localPeerId) return;

    const binding: AccountBinding = {
      userId: this.localUserId,
      peerId: this.localPeerId,
      username: this.localUsername ?? undefined,
      ...this.directory.get(this.localUserId),
      displayName: displayName ?? this.directory.get(this.localUserId)?.displayName,
      avatarRef: avatarRef ?? this.directory.get(this.localUserId)?.avatarRef,
      boundAt: Date.now(),
      ttl: MAX_TTL,
    };

    this.directory.set(this.localUserId, binding);
    if (binding.username) {
      this.indexUsername(binding.username, this.localUserId);
    }

    const msg: AccountSkinMessage = {
      type: 'account-bind',
      bindings: [binding],
      timestamp: Date.now(),
    };

    this.broadcast('skin', msg);
  }

  /** Send a bulk directory digest to a specific peer (e.g. on connection) */
  sendDigest(targetPeerId: string): void {
    const bindings = this.getActiveBindings();
    if (bindings.length === 0) return;

    const msg: AccountSkinMessage = {
      type: 'account-digest',
      bindings,
      timestamp: Date.now(),
    };

    this.sendToPeer(targetPeerId, 'skin', msg);
  }

  /** Query the mesh for a specific account's current peerId */
  queryAccount(userId: string): void {
    // Check local directory first
    const local = this.directory.get(userId);
    if (local && Date.now() - local.boundAt < STALE_MS) {
      if (this.onBindingResolved) {
        this.onBindingResolved(local);
      }
      return;
    }

    const msg: AccountSkinMessage = {
      type: 'account-query',
      queryUserId: userId,
      timestamp: Date.now(),
    };

    this.broadcast('skin', msg);
  }

  /**
   * Query the mesh by username. Resolves immediately if the username is in
   * the local index; otherwise broadcasts an `account-query` with `queryUsername`.
   * Newer peers will respond if they hold a matching binding; older peers ignore.
   */
  queryByUsername(username: string): void {
    const key = username.trim().toLowerCase();
    if (!key) return;
    const matches = this.resolveAllByUsername(key);
    if (matches.length) {
      for (const binding of matches) this.onBindingResolved?.(binding);
      return;
    }
    const msg: AccountSkinMessage = {
      type: 'account-query',
      queryUsername: key,
      timestamp: Date.now(),
    };
    this.broadcast('skin', msg);
  }

  /** Resolve a username to its current binding (local lookup only). */
  resolveByUsername(username: string): AccountBinding | null {
    const key = username.trim().toLowerCase();
    if (!key) return null;
    return this.resolveAllByUsername(key)[0] ?? null;
  }

  resolveAllByUsername(username: string): AccountBinding[] {
    const ids = this.usernameIndex.get(username.trim().toLowerCase()) ?? new Set<string>();
    return Array.from(ids).flatMap(id => { const binding = this.resolve(id); return binding ? [binding] : []; })
      .sort((a, b) => affinityScore(this.localUserId, b.userId) - affinityScore(this.localUserId, a.userId) || a.userId.localeCompare(b.userId));
  }

  private indexUsername(username: string, userId: string): void {
    const key = username.trim().toLowerCase();
    const ids = this.usernameIndex.get(key) ?? new Set<string>();
    ids.add(userId);
    this.usernameIndex.set(key, ids);
  }

  private removeUsername(username: string, userId: string): void {
    const key = username.trim().toLowerCase();
    const ids = this.usernameIndex.get(key);
    ids?.delete(userId);
    if (!ids?.size) this.usernameIndex.delete(key);
  }

  /** Handle incoming Skin protocol message */
  handleMessage(fromPeerId: string, message: AccountSkinMessage): void {
    switch (message.type) {
      case 'account-bind':
        this.handleBindings(message.bindings ?? [], fromPeerId);
        break;
      case 'account-digest':
        this.handleBindings(message.bindings ?? [], fromPeerId);
        break;
      case 'account-query':
        this.handleQuery(fromPeerId, message.queryUserId, message.queryUsername);
        break;
      case 'account-resolve':
        this.handleBindings(message.bindings ?? [], fromPeerId);
        break;
    }
  }

  /** Resolve a userId to its current peerId (local lookup) */
  resolve(userId: string): AccountBinding | null {
    const binding = this.directory.get(userId);
    if (!binding) return null;
    if (Date.now() - binding.boundAt > STALE_MS) return null;
    return binding;
  }

  /** Get all active (non-stale) bindings */
  getActiveBindings(): AccountBinding[] {
    const now = Date.now();
    return Array.from(this.directory.values()).filter(
      (b) => now - b.boundAt < STALE_MS
    );
  }

  /** Get full directory snapshot for dashboard */
  getDirectorySnapshot(): AccountBinding[] {
    return Array.from(this.directory.values());
  }

  /** Check if a Skin message */
  isSkinMessage(payload: unknown): payload is AccountSkinMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) return false;
    const type = (payload as AccountSkinMessage).type;
    return (
      type === 'account-bind' ||
      type === 'account-query' ||
      type === 'account-resolve' ||
      type === 'account-digest'
    );
  }

  // --- Private ---

  private handleBindings(bindings: AccountBinding[], fromPeerId: string): void {
    if (!Array.isArray(bindings)) return;
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object') continue;
      if (typeof binding.userId !== 'string' || !binding.userId || typeof binding.peerId !== 'string' || !binding.peerId) continue;
      if (typeof binding.ttl !== 'number' || !Number.isFinite(binding.ttl) || binding.ttl <= 0) continue;
      if (typeof binding.boundAt !== 'number' || !Number.isFinite(binding.boundAt)) continue;
      const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

      const existing = this.directory.get(binding.userId);

      // Accept if newer or unknown
      if (!existing || binding.boundAt > existing.boundAt) {
        const walletAddress = isPublicWalletAddress(binding.walletAddress) ? binding.walletAddress : undefined;
        // Relayed namespace coordinates are claims: apply them only after they
        // re-derive from this userId + wallet (see applyVerifiedNamespace).
        this.bindAccount(binding.userId, binding.peerId, {
          username: text(binding.username),
          displayName: text(binding.displayName),
          avatarRef: text(binding.avatarRef),
          walletAddress,
          ttl: Math.min(MAX_TTL, binding.ttl - 1),
        });
        if (walletAddress && (binding.namespaceId || binding.discriminator)) {
          void this.applyVerifiedNamespace(binding.userId, walletAddress, binding.namespaceId, binding.discriminator);
        }

        // Re-propagate with decremented TTL if still alive
        const forwardTtl = Math.min(MAX_TTL, binding.ttl - 1);
        if (forwardTtl > 0) {
          const forward: AccountSkinMessage = {
            type: 'account-bind',
            bindings: [{ ...binding, ttl: forwardTtl }],
            timestamp: Date.now(),
          };
          this.broadcast('skin', forward);
        }
      }
    }
  }

  private async applyVerifiedNamespace(userId: string, walletAddress: string, namespaceId: unknown, discriminator: unknown): Promise<void> {
    if (!(await verifyNamespaceIdentity(userId, walletAddress, namespaceId, discriminator))) return;
    const current = this.directory.get(userId);
    // The binding may have moved to another wallet while we were hashing.
    if (!current || current.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) return;
    current.namespaceId = (namespaceId as string).toLowerCase();
    current.discriminator = (discriminator as string).toLowerCase();
  }

  private handleQuery(fromPeerId: string, queryUserId?: string, queryUsername?: string): void {
    let bindings: AccountBinding[] = [];
    if (queryUserId) {
      const binding = this.resolve(queryUserId);
      if (binding) bindings = [binding];
    } else if (queryUsername) {
      bindings = this.resolveAllByUsername(queryUsername);
    }
    if (!bindings.length) return;

    const response: AccountSkinMessage = {
      type: 'account-resolve',
      bindings,
      timestamp: Date.now(),
    };

    this.sendToPeer(fromPeerId, 'skin', response);
  }

  private evictStaleEntries(): void {
    if (this.directory.size <= MAX_DIRECTORY_SIZE) return;

    const now = Date.now();
    const entries = Array.from(this.directory.entries())
      .sort((a, b) => b[1].boundAt - a[1].boundAt);

    // Keep most recent, evict stale first
    for (let i = entries.length - 1; i >= MAX_DIRECTORY_SIZE; i--) {
      const [userId, binding] = entries[i];
      if (userId !== this.localUserId) {
        this.directory.delete(userId);
        if (binding.username) this.removeUsername(binding.username, userId);
      }
    }

    // Also evict anything stale beyond threshold
    for (const [userId, binding] of this.directory) {
      if (userId !== this.localUserId && now - binding.boundAt > STALE_MS * 2) {
        this.directory.delete(userId);
        if (binding.username) this.removeUsername(binding.username, userId);
      }
    }
  }
}
