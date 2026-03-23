import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-4">
    <h2 className="text-xl font-bold text-foreground">{title}</h2>
    {children}
  </section>
);

const SubCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
    <h3 className="text-sm font-bold text-foreground">{title}</h3>
    {children}
  </div>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-foreground/70 leading-relaxed">{children}</p>
);

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-foreground">{children}</strong>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="text-xs bg-muted/30 px-1 rounded">{children}</code>
);

const Whitepaper = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 md:px-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 gap-2 text-muted-foreground"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Button>

        <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6 md:p-10 space-y-8">
          <header>
            <h1 className="text-3xl font-bold font-display uppercase tracking-[0.18em] mb-2">Whitepaper</h1>
            <p className="text-sm text-muted-foreground">Imagination Network — Technical Architecture v5.0</p>
          </header>

          {/* ─── VISION ─── */}
          <Section title="Vision">
            <P>
              The Imagination Network is a decentralized, offline-first social architecture where every participant's device is a sovereign node. It combines peer-to-peer mesh networking, a client-side multi-chain blockchain, torrent-style content distribution, Gun.js relay infrastructure, and end-to-end encryption to deliver a platform where creators, researchers, and builders collaborate without centralized servers. Content, identity, credits, and distribution are entirely user-owned — hosted, shared, and discovered through a resilient multi-transport mesh that prioritizes privacy, creative freedom, and network honesty.
            </P>
          </Section>

          {/* ─── THREE-TIER P2P ─── */}
          <Section title="Three-Tier P2P Architecture">
            <P>
              The network operates through three mutually exclusive standalone modes. Only one mode runs at a time to prevent PeerJS identity collisions. Transitioning between modes includes a 2,500 ms cooldown to allow signaling servers to release session IDs. All modes enforce a <B>Never-Rotate</B> identity policy — each node keeps the persistent ID <Code>peer-&#123;nodeId&#125;</Code> derived from Ed25519 keys across sessions.
            </P>

            <div className="space-y-5">
              <SubCard title="1. SWARM Mesh — Production Mode">
                <P>
                  The automated, production-ready mode uses a three-phase <B>Cascade Connect</B> strategy:
                </P>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Bootstrap:</B> Hardcoded seed nodes are dialled first. A Phase 1b retry targets peers returning "peer-unavailable" errors after a brief settle period. Bootstrap nodes use a silent hourly retry mechanism for persistent background connectivity.</li>
                  <li><B>Library:</B> Previously successful peers stored in the Connection Library are reconnected.</li>
                  <li><B>Manual Fallback:</B> Users can paste a peer ID for direct connection.</li>
                </ol>
                <P>
                  Features <B>Peer List Exchange (PEX)</B> and <B>Global Triangle Gossip</B> — when Peer A connects to Peer C, it re-broadcasts its updated library to Peer B (and all other active connections), ensuring B and C discover and connect to each other regardless of application route. Presence broadcasts occur every 10 seconds. Mining is automatic with a 15-second interval, serving as a network-stabilizing "pulse."
                </P>
              </SubCard>

              <SubCard title="2. Builder Mode — Manual Orchestration">
                <P>
                  A manual interface for creating private or controlled mesh environments. Governed by seven interlocked controls with strict dependencies:
                </P>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Build a Mesh:</B> Prioritizes user-defined connections, ignoring global SWARM requests.</li>
                  <li><B>Blockchain Sync:</B> Master switch for all crypto features — when disabled, NFTs, mining, credits, tips, and wallet are deactivated.</li>
                  <li><B>Auto-connect:</B> Toggles automatic dialing of prior library connections.</li>
                  <li><B>Approve Only:</B> High-privacy mode forcing Build a Mesh and Auto-connect OFF, requiring manual handshake approval.</li>
                  <li><B>Torrent Serving:</B> Controls participation in media syncing, serving, and seeding.</li>
                  <li><B>Mining:</B> Requires Blockchain Sync to be active.</li>
                  <li><B>Swarm Accept:</B> Allows the node to accept global SWARM mesh requests.</li>
                </ol>
                <P>
                  Includes optional Gun.js relay support for broader network connectivity and maintains a separate connection library with handshake parity to the foundational Test Mode.
                </P>
              </SubCard>

              <SubCard title="3. Test Mode — Stability Cornerstone">
                <P>
                  The foundational reference architecture from which all other modes derive. Implements a dynamic reconnection lifecycle (15 s → 30 s → 60 s). If all attempts fail, the network flag is disabled and the user is prompted to refresh. Maintains a persistent Connection Library for auto-dialling known peers and syncs content with the main feed via the global <Code>p2p-posts-updated</Code> event bridge.
                </P>
              </SubCard>
            </div>
          </Section>

          {/* ─── GUN.JS + CONTENT DELIVERY ─── */}
          <Section title="Multi-Transport Infrastructure">
            <P>
              Unlike standard P2P applications that rely on a single transport layer, the Imagination Network operates a <B>multi-transport mesh</B> combining three complementary protocols for maximum resilience:
            </P>

            <div className="space-y-3">
              <SubCard title="PeerJS WebRTC — Primary Transport">
                <P>
                  Direct browser-to-browser connections via WebRTC DataChannels provide low-latency, high-throughput communication. All mesh modes use PeerJS as the primary signaling and data channel. Connection health is monitored with configurable liveness thresholds (30 s standard, 60 s for energized mining peers).
                </P>
              </SubCard>

              <SubCard title="Gun.js — Relay & Recovery Layer">
                <P>
                  Gun.js provides a secondary signaling and data transport layer using public relay servers (including the Manhattan Gun relay). It is automatically enabled for SWARM Mesh mode and available as a togglable option in Builder Mode. Gun.js serves three critical roles:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>WebRTC Call Recovery:</B> When direct PeerJS connections fail, Gun.js maintains signaling continuity for streaming rooms.</li>
                  <li><B>Torrent Fallback:</B> All core torrent messages (<Code>interested</Code>, <Code>have</Code>, <Code>request</Code>, <Code>piece</Code>) fall back to the Gun relay when direct WebRTC connections stall, with a 15-second polling loop activated after 60 seconds of inactivity.</li>
                  <li><B>Supplemental Gossip:</B> Broadcasts peer discovery, presence, and content announcements through the Gun graph when PeerJS signaling is inconsistent.</li>
                </ul>
                <P>
                  The GunAdapter dynamically imports Gun.js, uses <Code>BroadcastChannel</Code> as a same-origin fallback, deduplicates messages via a <Code>seenMessageIds</Code> cache, and supports both targeted sends and broadcast-to-all patterns.
                </P>
              </SubCard>

              <SubCard title="Cross-Mode Content Bridge">
                <P>
                  A shared <Code>BroadcastChannel</Code> ("swarm-space-content") enables inter-protocol visibility between SWARM Mesh and Builder Mode users. When activated, posts, comments, and content are automatically synced between modes via upsert logic that only accepts newer timestamps. A unified Network ID resolver auto-detects input formats (Node ID vs. Peer ID), allowing users in different modes to connect and exchange content seamlessly.
                </P>
              </SubCard>
            </div>
          </Section>

          {/* ─── TORRENT SWARMING ─── */}
          <Section title="Torrent-Style Content Distribution">
            <P>
              File distribution uses a fully self-contained torrent swarming system that operates through the existing mesh network — no external BitTorrent infrastructure required. This represents a <B>fundamental departure from standard file-sharing architectures</B>: instead of centralized trackers, the mesh itself serves as the swarm coordinator.
            </P>

            <div className="space-y-3">
              <SubCard title="Swarming Protocol">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Fixed 1 MiB Chunk Size:</B> All files use 1,048,576-byte chunks, ensuring a 1:1 ratio between file size in MiB and chunk count (e.g., 17.2 MB = 18 chunks).</li>
                  <li><B>Rarest-First Selection:</B> Chunks are requested in order of scarcity across the swarm, maximizing distribution efficiency.</li>
                  <li><B>Seeder-to-Leecher Pipeline:</B> As leechers receive chunks, they immediately become seeders for those chunks.</li>
                  <li><B>Manifest Announcements:</B> Seeders create torrent manifests (SHA-256 chunk hashes, content hash, total size) and announce them to the mesh via the "torrent" channel.</li>
                  <li><B>AES-256-GCM Per-Peer Encryption:</B> Chunks are encrypted during transport using per-peer keys.</li>
                  <li><B>Interest Rebroadcasting:</B> Every 10 seconds, active downloaders rebroadcast interest to discover new seeders.</li>
                </ul>
              </SubCard>

              <SubCard title="Resilience & Self-Healing">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Gun Recovery Mode:</B> After 60 seconds of stall, a 15-second polling loop requests missing chunks specifically through the Gun relay.</li>
                  <li><B>Bloat Protection:</B> Torrents with more than 10 peer failures are auto-paused for 1 hour.</li>
                  <li><B>Dead Torrent Cleanup:</B> Torrents with 0 seeders and 0 progress after 5 minutes are automatically removed.</li>
                  <li><B>Legacy Re-Seeding:</B> On startup, the system automatically re-seeds legacy files to migrate them to the 1 MiB standard.</li>
                  <li><B>Adaptive Chunking (100 MB+):</B> Files exceeding 100 MB use a stress-aware adaptive batcher that monitors CPU/memory pressure, adjusts concurrency dynamically, and yields to the main thread between batches to prevent UI freezing.</li>
                </ul>
              </SubCard>
            </div>
          </Section>

          {/* ─── BLOCKCHAIN vs STANDARD CHAINS ─── */}
          <Section title="On-Device Multi-Chain Blockchain">
            <P>
              The SWARM blockchain is <B>fundamentally different from standard blockchain implementations</B> in several critical ways:
            </P>

            <div className="space-y-3">
              <SubCard title="How SWARM Differs from Standard Chains">
                <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
                  <li><B>No External Validators:</B> Unlike Ethereum, Bitcoin, or Solana, SWARM has no dedicated validator nodes, no stake pools, and no mining rigs. Every user's browser IS the validator — blocks are mined in-browser using Web Crypto API and confirmed through peer mesh consensus.</li>
                  <li><B>Social-Action Transaction Model:</B> Standard blockchains record financial transfers. SWARM records <em>every user action</em> — posts, comments, reactions, file uploads, achievements, rewards — as first-class blockchain transactions. Every post is inherently an NFT.</li>
                  <li><B>Dual-Recorder Architecture:</B> Two complementary systems record transactions simultaneously: the <Code>blockchainRecorder</Code> (chain-tagged NFT transactions with media manifests) and the <Code>meshInlineRecorder</Code> (direct mesh injection with offline queuing). This ensures zero transaction loss even during network partitions.</li>
                  <li><B>Multi-Layer Persistence:</B> The chain uses a <Code>whenReady()</Code> promise pattern to prevent data access during hydration, synchronous <Code>beforeunload</Code>/<Code>visibilitychange</Code> listeners to flush dirty states to localStorage as a crash-recovery snapshot, and reconciled IndexedDB synchronization for long-term storage. On reload, the system picks whichever state has more blocks (IndexedDB vs. snapshot).</li>
                  <li><B>Mesh-Inline Mining:</B> Unlike standard chains where mining is separate from application logic, SWARM mining is <em>inline with the mesh</em>. Transactions flow directly through the active mesh's pending pool, are auto-mined into the next block, and broadcast to peers via existing mesh channels — zero separate blockchain connections, zero extra signaling.</li>
                  <li><B>Offline Action Queue:</B> When the mesh is disconnected, all user actions are queued locally as <Code>offline-*</Code> transactions. The moment a peer connection is established, the queue is automatically flushed into the mesh's pending transaction pool.</li>
                </ul>
              </SubCard>

              <SubCard title="SWARM Main Chain">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>SHA-256 block hashes with Merkle root integrity verification</li>
                  <li>30-second block time, difficulty 4, mining reward 50 SWARM</li>
                  <li>Halving every 210,000 blocks — hard cap 21,000,000 SWARM</li>
                  <li>5% network pool mining tax on all rewards</li>
                  <li>Balance-affecting transaction types: <Code>token_transfer</Code>, <Code>token_mint</Code>, <Code>token_burn</Code>, <Code>mining_reward</Code>, <Code>credit_lock</Code>, <Code>coin_deploy</Code>, <Code>pool_donate</Code>, <Code>creator_token_deploy</Code>, <Code>cross_chain_swap</Code></li>
                  <li>Cross-chain sync via P2P mesh with longest-chain consensus and 2-minute periodic sync interval</li>
                  <li>Reward pool merge uses higher-balance strategy with per-contributor reconciliation</li>
                </ul>
              </SubCard>

              <SubCard title="User-Deployed Sub-Chains (Coins)">
                <P>
                  Coin deployments are blockchain deployments — the term "coin" is used for simplicity. The total cost of 10,000 SWARM is split:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>5,000 SWARM locked as liquidity</B> — gives the coin an intrinsic floor value in SWARM once blocks are mined</li>
                  <li><B>5,000 SWARM to the community pool</B> — funds the ecosystem reward infrastructure</li>
                  <li>Validation: 3-6 character uppercase ticker (excluding "SWARM"), 1-32 character chain name, minimum 10-character project goal</li>
                  <li>Independent ledger tagged with chain ID & ticker, auto-bridged to SWARM via <Code>swarm-bridge://&#123;coinId&#125;</Code></li>
                  <li>Per-chain balance scanning: sub-chain transactions are filtered by <Code>chainId</Code> across all blocks</li>
                  <li>Cross-chain swaps: 1:1 between sub-chains, 2:1 when swapping TO SWARM, 1:1 SWARM to sub-chain</li>
                  <li>Mining is context-aware — rewards accrue on the active chain with chain-tagged reward transactions</li>
                  <li>Chain switching is instant and does not disrupt the underlying P2P mesh connection</li>
                  <li><B>All coins must pass mineHealth validation</B> before deployment — ensuring the deployer is an active, honest mesh participant</li>
                </ul>
              </SubCard>

              <SubCard title="Coins vs Tokens — Fundamental Distinction">
                <P>
                  The Imagination Network enforces a strict separation between <B>coins</B> and <B>tokens</B>:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Coins are ONLY mined</B> — every SWARM coin exists because a node performed CREATOR Proof work and had a block confirmed by the mesh. Coins are never minted, never created from thin air.</li>
                  <li><B>Tokens are ONLY minted</B> — Creator Tokens represent a user's "worth" to the network. They are deployed (1,000 credit cost), have a fixed 10,000 supply, and unlock gradually as the creator earns credits.</li>
                  <li>A minted token can <B>never</B> be used to wrap other tokens — only a mined coin can serve as a wrapper.</li>
                </ul>
              </SubCard>

              <SubCard title="Creator Tokens — Network Worth & Dual-Swap System">
                <P>
                  When a user deploys a Creator Token, it represents their <B>"worth" to the network</B>. Tokens unlock similarly to SWARM code mining, but only for the minted token supply:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>One per account, fixed max supply of 10,000 tokens</li>
                  <li>Deployment cost: 1,000 credits</li>
                  <li>Unlocked gradually at 10 tokens per 1 credit earned (mirrors SWARM mining unlock cadence)</li>
                  <li>10 Creator Tokens carry a "hype" value equivalent to 1 credit</li>
                  <li>Once used to lock an NFT post, the token cannot be renamed or redeployed</li>
                </ul>
                <P>
                  <B>Dual-Swap System:</B> Creator Tokens can be exchanged via two paths:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Token → Credits (1:1)</B> — direct swap, no pool dependency</li>
                  <li><B>Token → SWARM (10:1)</B> — 10 tokens required for 1 SWARM coin, executed via Literal Wrap</li>
                </ul>
              </SubCard>

              <SubCard title="Literal Wrap Protocol — Tokens Inside Coins">
                <P>
                  When tokens are swapped for SWARM, they are <B>physically wrapped inside a mined coin</B> as metadata. The token payload remains with the coin until extracted. Real coins carry real tokens inside them.
                </P>
                <P><B>Wrapping Process:</B></P>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li>User must pass <Code>mineHealth</Code> validation (graveyard throttle — must be actively mining)</li>
                  <li>Community pool must hold <B>requestedAmount + 1</B> coins — the +1 is the wrapper coin</li>
                  <li>System checks if the selected coin can support the metadata weight: <Code>amount × 1 + 5 overhead</Code> must fit within the coin's <Code>maxWeight</Code> (100)</li>
                  <li>If the coin is full or would overflow, all pool coins are <B>shuffled</B> and the system picks a new one. Already-checked coins are <B>tagged</B> to prevent re-testing</li>
                  <li>Token payload is embedded as metadata inside the selected coin</li>
                  <li>The wrapper coin (+1) is returned to the community pool</li>
                </ol>
                <P><B>Extraction:</B> Users may extract tokens from coins they own in their wallet:</P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>All wrapped tokens are credited back to the user's holdings on the SWARM blockchain</li>
                  <li>The now-empty coin is returned to the community pool</li>
                  <li>Recorded as a <Code>token_extract</Code> transaction on-chain</li>
                </ul>
                <P><B>Weight & Value:</B> Coins with higher wrapped weight become <B>organically more valuable</B> across the network — all tokens can be swapped for SWARM or used for features across the mesh. The system may pay users with any coin, including wrapped ones.</P>
                <P><B>Graveyard Throttle:</B> To swap, you must be mining. The 5% mining tax always seeds an <B>empty coin</B> into the community pool, guaranteeing the pool never runs out of wrappers.</P>
              </SubCard>

              <SubCard title="Coin Deployment — Sub-Chain Creation">
                <P>
                  Coin deployments are effectively "blockchain deployments" — independent sub-chains cross-linked to SWARM. The 10,000 SWARM deployment cost is split:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>5,000 SWARM locked as liquidity</B> — gives the coin intrinsic floor value; worth accrues as blocks are mined on the sub-chain</li>
                  <li><B>5,000 SWARM to the community pool</B></li>
                  <li>All deployed coins must comply with <Code>mineHealth</Code> protocols</li>
                </ul>
              </SubCard>

              <SubCard title="Credit Wrapping & Community Pool">
                <P>
                  100 Imagination Credits lock into 1 SWARM token via the community pool. The wrapping system uses a <B>queue-based processing model</B>: wrap requests are created, validated against credit balance, and processed in FIFO order. Processing depends on pool liquidity — if the pool balance is insufficient, requests wait until donations or mining taxes replenish it. Credits are deducted atomically and recorded as <Code>credit_lock</Code> transactions on-chain. All wrap operations must pass <B>mineHealth validation</B> — ensuring the wrapping node is actively participating in the mesh. Users can donate SWARM tokens directly to the pool, which immediately triggers processing of any pending wrap requests.
                </P>
              </SubCard>

              <SubCard title="MineHealth Protocol — Economic Gating">
                <P>
                  All economic operations (token swaps, coin deployments, credit wrapping, literal wraps) are gated by the <B>mineHealth validator</B>. This protocol ensures that only active, honest mesh participants can execute value-bearing transactions:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Active Mining Check</B> — node must have a current mining session or a block mined within the last 60 seconds</li>
                  <li><B>Peer Connectivity</B> — at least 1 active peer connection (relaxed for solo-bootstrap when mining is active)</li>
                  <li><B>Content Activity</B> — hollow-only blocks trigger reduced rewards, preventing passive economic extraction</li>
                  <li>Failed mineHealth checks return human-readable reasons: "No active mining session" or "No active peer connections"</li>
                </ul>
              </SubCard>

              <SubCard title="Cross-Chain Bridge to External Chains">
                <P>
                  An external bridge system supports lock-and-mint transfers to Ethereum, Polygon, and BSC. Tokens are burned on the source chain and minted (minus a 1% bridge fee + base fee) on the target chain. Bridges are reversible while pending, with status tracking (<Code>pending → completed → failed</Code>). All cross-chained coins must comply with mineHealth protocols.
                </P>
              </SubCard>
            </div>
          </Section>

          {/* ─── UQRC MINING OPTIMIZATIONS ─── */}
          <Section title="UQRC Mining Optimizations">
            <P>
              The mining engine implements <B>Universal Quantum-Relative Calculus (UQRC) compatible optimizations</B> designed to reduce "network curvature" — mathematical inefficiencies in the mining manifold — while preserving proof-of-work security. These are <B>non-consensus layer improvements</B> that run strictly locally:
            </P>

            <div className="space-y-3">
              <SubCard title="4.1 — Deterministic Template Stabilization">
                <P>
                  Freezes the block template for a 750 ms window to reduce mempool update advantage. While the template is frozen, new pending transactions are buffered rather than immediately changing the mining target. This eliminates the <Code>[D_mempool, D_hash]</Code> curvature — miners can't gain advantage by front-running transaction inclusion. Templates are invalidated after each successful block.
                </P>
              </SubCard>

              <SubCard title="4.2 — Nonce-Space Partitioning">
                <P>
                  The 32-bit nonce space (4.29 billion values) is deterministically partitioned into 256 zones using <Code>SHA-256(minerID) mod 256</Code>. Each miner operates exclusively within their assigned partition, eliminating redundant hashing across the network. This reduces <Code>F_μν^hash = 0</Code> with zero nonce overlap — no two miners ever test the same nonce.
                </P>
              </SubCard>

              <SubCard title="4.3 — Propagation-Aware Broadcasting">
                <P>
                  Newly mined blocks are held until a peer quorum of 2 is reached, reducing orphan rates. If quorum isn't met within 5 seconds, blocks are broadcast regardless to prevent stalling. The broadcaster tracks connected peer count in real-time and includes propagation status metadata with every mined block event.
                </P>
              </SubCard>

              <SubCard title="4.4 — Timestamp Smoothing">
                <P>
                  Enforces monotonic timestamp progression with a maximum 60-second future drift tolerance. Each new block's timestamp must strictly exceed the previous block and the miner's own last-issued timestamp. This reduces difficulty oscillation caused by timestamp manipulation, following the UQRC curvature reduction principle where <Code>Q_Score(u) := ||[D_μ, D_ν]|| + ||∇_μ ∇_ν S(u)|| + λ(ε_0)</Code>.
                </P>
              </SubCard>

              <SubCard title="Quantum Score Metrics">
                <P>
                  The mining engine exposes real-time curvature metrics via the Quantum Metrics Panel: template curvature (0 when frozen, 1 when unfrozen), nonce curvature (always 0 due to partitioning), propagation curvature (0 at quorum, scales with missing peers), timestamp curvature (0 when smoothing enabled). The total Q_Score follows UQRC with <Code>λ(ε_0) = 10^-100</Code> as the Planck-scale constant.
                </P>
              </SubCard>
            </div>

            <SubCard title="What UQRC Prevents — Comparison to Standard Chains">
              <P>
                Traditional blockchains (Bitcoin, Ethereum, and most PoW/PoS forks) suffer from four systemic attack vectors that the UQRC curvature-reduction framework <B>mathematically eliminates at the protocol level</B>:
              </P>
              <ol className="list-decimal pl-5 space-y-3 text-sm text-foreground/70 leading-relaxed">
                <li>
                  <B>MEV / Front-Running (Template Stabilization §4.1):</B> On Ethereum, miners and validators extract <B>Miner Extractable Value</B> by reordering, inserting, or censoring transactions — sandwich attacks on DEX trades, liquidation sniping, and priority gas auctions. The 750 ms template freeze window makes this <em>structurally impossible</em>: once a block template is frozen, no new transactions can alter the mining target until the next window. The mempool-to-hash curvature <Code>[D_mempool, D_hash]</Code> collapses to zero — there is no reordering advantage because the template is immutable during hashing. No other browser-based chain enforces this.
                </li>
                <li>
                  <B>Selfish Mining / Block Withholding (Propagation-Aware §4.3):</B> In Bitcoin, a miner who finds a block can privately withhold it and mine the next block on top, gaining a head start — the classic "selfish mining" attack that can be profitable at &gt;33% hash power. SWARM's propagation-aware broadcaster <em>requires peer quorum before the block enters the local chain state</em>. A block that cannot reach 2 peers within 5 seconds is force-broadcast anyway, but the quorum gate means privately withheld blocks cannot accumulate — the chain only advances when the mesh acknowledges. This converts selfish mining from a game-theory exploit into a protocol violation.
                </li>
                <li>
                  <B>Energy Waste / Hash Collision (Nonce Partitioning §4.2):</B> Every standard PoW chain — Bitcoin, Litecoin, Dogecoin, all forks — allows all miners to search the entire nonce space simultaneously, meaning multiple miners routinely hash the <em>exact same nonce</em> for the same block. This is pure wasted energy. UQRC's deterministic <Code>SHA-256(minerID) mod 256</Code> partitioning assigns each miner an exclusive 16.7 million-nonce zone. The hash overlap curvature <Code>F_μν^hash</Code> drops to exactly zero — no two miners on the SWARM network ever test the same nonce for the same block template. This is a zero-waste mining manifold that no production blockchain has implemented.
                </li>
                <li>
                  <B>Difficulty Manipulation / Time-Warp (Timestamp Smoothing §4.4):</B> Bitcoin's difficulty adjusts every 2,016 blocks based on median timestamps, but miners can drift timestamps within a 2-hour window to artificially lower difficulty — the "time-warp" attack documented since 2011. SWARM enforces <em>strict monotonic progression</em>: each block timestamp must exceed both the previous block's timestamp and the miner's own last-issued timestamp, with a hard 60-second future drift cap. The timestamp curvature is clamped to zero, making difficulty manipulation mathematically infeasible regardless of hash power.
                </li>
              </ol>
              <P>
                Combined, these four protections drive the total network curvature <Code>Q_Score(u)</Code> toward zero — meaning the mining manifold is <B>geometrically flat</B>. A flat manifold has no exploitable gradients: no path through the protocol is more profitable than honest mining. This is the core UQRC contribution — not just optimization, but the <em>elimination of adversarial geometry</em> from proof-of-work consensus.
              </P>
            </SubCard>
          </Section>

          {/* ─── CREATOR PROOF MINING ─── */}
          <Section title="CREATOR Proof Mining">
            <P>
              <B>CREATOR</B> — <em>Content Rendering Empowering Action Through Our Realm</em> — is the consensus mechanism that transforms block production into "Honest Mining," an active network-stabilizing pulse strictly gated by peer connectivity.
            </P>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><B>Connectivity Gate:</B> Rewards only accumulate when the node is online and has active peer connections. Disconnected nodes see a "Not Mining" status with all active dashboard panels replaced.</li>
              <li><B>Content Verification:</B> Blocks must be verified by local content activity (seeding/receiving) and confirmed via mesh consensus (majority peer votes) before being awarded.</li>
              <li><B>Hollow Block Penalty:</B> Blocks produced without active content rendering are flagged as "hollow" and receive a 50% reward reduction.</li>
              <li><B>Enriched Broadcasts:</B> Mining broadcasts include metadata (peerCount, blockHeight, PEX data) and are acknowledged with <Code>mining-ack</Code> for RTT measurement.</li>
              <li><B>Energized Priority:</B> Actively mining peers receive priority in reconnection and extended liveness thresholds (60 s vs 30 s).</li>
              <li><B>Reward Structure:</B> Transaction processing: 0.1 SWARM per confirmed mesh work action. Content hosting: 0.05 SWARM per network service unit (heartbeats, acks). Peer connection alone earns nothing — the <Code>rewardPeerConnection</Code> function is explicitly a no-op.</li>
              <li><B>Community Pool Tax:</B> 5% of all mining rewards are automatically directed to the community reward pool, which funds credit wrapping and network incentives.</li>
            </ul>
          </Section>

          {/* ─── ENCRYPTION V2 ─── */}
          <Section title="Encryption Architecture V2">
            <P>
              Content flows through a multi-stage pipeline with three distinct encryption systems working in concert — a <B>unified content pipeline</B>, a <B>multi-stage V2 encryption protocol</B>, and <B>peer-to-peer transport encryption</B>:
            </P>

            <div className="space-y-3">
              <SubCard title="Unified Content Pipeline (Primary Path)">
                <P>
                  ALL user-generated content — posts, comments, reactions, files — flows through a single enforced pipeline:
                </P>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Encrypt:</B> Raw content is salted (16-byte random), hashed (SHA-256), and encrypted using ECDH (P-256) key exchange with AES-256-GCM. Each message gets a unique ephemeral keypair and IV.</li>
                  <li><B>Chunk:</B> Ciphertext is split into fixed 1 MiB content-addressed chunks with SHA-256 refs. Each chunk receives an HMAC integrity tag derived via PBKDF2 (10,000 iterations) from the content hash.</li>
                  <li><B>Store:</B> Chunks and their manifest are persisted to encrypted IndexedDB stores.</li>
                  <li><B>Push to Mesh:</B> Manifest and chunks are broadcast to peers via the active P2P transport.</li>
                </ol>
                <P>
                  No content bypasses this pipeline. Reading reverses the flow: load manifest → reassemble chunks → ECDH derive shared key → AES-GCM decrypt → verify SHA-256 integrity.
                </P>
              </SubCard>

              <SubCard title="V2 Multi-Stage Protocol (Extended Path)">
                <ol className="list-decimal pl-5 space-y-2 text-sm text-foreground/70">
                  <li><B>Stage A — Sign & Encrypt:</B> Content is signed with Ed25519 for authenticity, then encrypted using ECDH with the creator's public key. Public content skips encryption but retains signing.</li>
                  <li><B>Stage B — Secure Chunking:</B> Encrypted payloads are split into 32 KB signed chunks with Ed25519 peer signatures, chunk hashes, and Merkle proofs for blockchain inclusion. Each chunk carries peer identity, encrypted payload, metadata, and a chunk-end marker with the content signature.</li>
                  <li><B>Stage C — Blockchain Transport Encryption:</B> Chunks are further encrypted for blockchain storage using PBKDF2-derived keys (100,000 iterations) seeded from the latest block hash, creating a deterministic encryption key that binds content to the blockchain state.</li>
                  <li><B>Stage D — Local Signed Plaintext:</B> On the receiving node, content is decrypted and stored as signed plaintext for immediate rendering.</li>
                </ol>
              </SubCard>

              <SubCard title="Peer-to-Peer Transport Security">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>ECDH Key Agreement:</B> Each transport session uses per-peer ephemeral ECDH key pairs (P-256) to derive AES-256-GCM encryption keys.</li>
                  <li><B>Private Content:</B> Multi-recipient encryption uses a symmetric key encrypted individually for each recipient via their ECDH public key, enabling efficient group distribution.</li>
                  <li><B>Content Hash Verification:</B> All decrypted content is verified against its SHA-256 content hash — any corruption or tampering is detected and rejected.</li>
                </ul>
              </SubCard>
            </div>
          </Section>

          {/* ─── IDENTITY & KEY MANAGEMENT ─── */}
          <Section title="Two-Key Identity Model">
            <P>
              Unlike standard web apps using server-side auth, or even typical crypto wallets using a single mnemonic, the Imagination Network employs a <B>dual-key identity architecture</B> that separates device-level access from network-wide recovery:
            </P>

            <div className="space-y-3">
              <SubCard title="Key Generation & Wrapping">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>ECDH P-256 Identity Keypair:</B> Generated via Web Crypto API. The public key is exported as SPKI for peer exchange; the private key is exported as PKCS8 for wrapping.</li>
                  <li><B>User ID Derivation:</B> <Code>SHA-256(publicKey)</Code> truncated to 16 hex characters — deterministic, collision-resistant, and tied to the keypair.</li>
                  <li><B>Password Wrapping:</B> The private key is encrypted using AES-256-GCM with a key derived from the user's password via <B>PBKDF2 (200,000 iterations, SHA-256)</B>. The wrapped key, random salt (16 bytes), and IV (12 bytes) are stored in IndexedDB.</li>
                  <li><B>Session Caching:</B> On successful login, the unwrapped private key is cached in <Code>sessionStorage</Code> (never localStorage) for the duration of the browser session, avoiding repeated decryption.</li>
                </ul>
              </SubCard>

              <SubCard title="Passphrase Mesh Recovery Protocol">
                <P>
                  The 200-character minimum backup passphrase powers a <B>zero-knowledge distributed recovery system</B> that has no equivalent in standard applications:
                </P>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Dual Key Derivation:</B> From the passphrase, PBKDF2 (250,000 iterations) derives two independent keys using distinct salts: an AES-256-GCM <em>encryption key</em> and an HMAC-SHA256 <em>tag key</em>.</li>
                  <li><B>Identity Encryption:</B> The full identity payload (UserMeta + wrapped private key) is encrypted. The IV is prepended to the ciphertext for self-contained decryption.</li>
                  <li><B>512-Byte Chunk Splitting:</B> The encrypted blob is split into fixed 512-byte chunks. Each chunk receives an HMAC-derived lookup tag: <Code>HMAC(tagKey, "backup-chunk:&#123;index&#125;")</Code>.</li>
                  <li><B>Mesh Distribution:</B> Tagged chunks are broadcast to mesh peers. Peers store them by tag without knowledge of the passphrase, content, or owner.</li>
                  <li><B>Recovery:</B> On a new device, the user enters the passphrase → derives the same tag key → computes expected tags → queries mesh peers → reassembles → decrypts. Requires ≥1 online peer holding chunks.</li>
                </ol>
                <P>
                  The passphrase strength is validated with Shannon entropy analysis — repetitive phrases (entropy &lt; 3.0) are rejected. An entropy meter guides users toward high-quality passphrases in real time.
                </P>
              </SubCard>

              <SubCard title="Session Restore & Browser Resilience">
                <P>
                  Unlike applications that lose state when localStorage is cleared (e.g., Brave Shields), the system implements a <B>multi-layer session restore</B>: localStorage fast path → IndexedDB <Code>lastActiveUserId</Code> lookup → single-account auto-restore fallback. The last active user ID is persisted redundantly in IndexedDB, surviving cache clears, private browsing mode transitions, and browser data purges.
                </P>
              </SubCard>

              <SubCard title="Ed25519 Rendezvous Identity">
                <P>
                  Separate from the ECDH identity keypair, each node generates a dedicated <B>Ed25519 signing identity</B> for presence tickets and chunk signatures. This key is persisted in localStorage and is used for all mesh-level authentication — signing presence broadcasts, chunk payloads, and gossip messages. The separation ensures that transport-level authentication is independent of the user's encryption identity.
                </P>
              </SubCard>
            </div>
          </Section>

          {/* ─── PROTECTED STORAGE ─── */}
          <Section title="Protected Storage & Data Integrity">
            <P>
              Standard web applications store data in plain IndexedDB, readable by anyone with browser DevTools. The Imagination Network implements a <B>Protected Storage Layer</B> that makes local data cryptographically immutable:
            </P>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
              <li><B>Private-Key-Derived Encryption:</B> Each record is encrypted with AES-256-GCM using a key derived from the user's private key via PBKDF2 (100,000 iterations). Only the key holder can read or write.</li>
              <li><B>HMAC Tamper Detection:</B> Every encrypted record includes an HMAC-SHA256 integrity tag. On read, the HMAC is verified before decryption — any manual edit to the encrypted data in DevTools is detected and the record is rejected.</li>
              <li><B>Key Rotation Support:</B> Records can be re-encrypted with a new key via <Code>reencryptProtected()</Code>, enabling key rotation without data loss.</li>
              <li><B>Batch Operations:</B> Bulk read/write operations execute in parallel for efficiency while maintaining per-record encryption and integrity.</li>
            </ul>
          </Section>

          {/* ─── INDEXEDDB SCHEMA ─── */}
          <Section title="20-Store IndexedDB Schema">
            <P>
              The application uses a <B>20-store IndexedDB schema</B> (version 20) with compound indexes — a custom database architecture that exceeds typical web app storage patterns. This is not a wrapper around a cloud database; it IS the database:
            </P>
            <div className="space-y-3">
              <SubCard title="Core Stores">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>chunks</B> — Content-addressed encrypted data pieces (keyPath: <Code>ref</Code>)</li>
                  <li><B>manifests</B> — File manifests with chunk lists, MIME types, signatures (keyPath: <Code>fileId</Code>)</li>
                  <li><B>meta</B> — Key-value store for wrapped keys, backup manifests, content manifests (keyPath: <Code>k</Code>)</li>
                  <li><B>posts</B> — Social content with blog classification, signatures, badge snapshots</li>
                  <li><B>comments</B> — Indexed by <Code>author</Code>, <Code>createdAt</Code>, <Code>postId</Code></li>
                  <li><B>users</B> — User profiles with ECDH public keys and wrapped key references</li>
                </ul>
              </SubCard>
              <SubCard title="Social & Engagement Stores">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>postMetrics</B> — 5 indexes: <Code>viewCount</Code>, <Code>viewTotal</Code>, <Code>creditTotal</Code>, <Code>creditCount</Code>, <Code>updatedAt</Code></li>
                  <li><B>entanglements</B> — Quantum-themed follow graph with compound <Code>userTargetKey</Code> unique index</li>
                  <li><B>notifications</B> — Indexed by <Code>userId</Code>, <Code>read</Code>, <Code>createdAt</Code></li>
                  <li><B>connections</B> — Peer connection records with <Code>status</Code> and bidirectional user indexes</li>
                </ul>
              </SubCard>
              <SubCard title="Blockchain & Economy Stores">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>blockchain</B> — Full chain state with blocks, pending transactions, difficulty</li>
                  <li><B>tokenBalances</B>, <B>nfts</B> (indexed by <Code>minter</Code>, <Code>achievementId</Code>, <Code>badgeId</Code>)</li>
                  <li><B>bridges</B> — Cross-chain bridge records indexed by <Code>sourceChain</Code>, <Code>targetChain</Code>, <Code>status</Code></li>
                  <li><B>creditTransactions</B> — Full audit trail indexed by <Code>fromUserId</Code>, <Code>toUserId</Code>, <Code>type</Code>, <Code>createdAt</Code></li>
                  <li><B>creditBalances</B>, <B>rewardPool</B>, <B>wrapRequests</B> (indexed by <Code>userId</Code>, <Code>status</Code>)</li>
                  <li><B>deployedCoins</B> — User-created sub-chains indexed by <Code>deployerUserId</Code>, <Code>ticker</Code>, <Code>status</Code></li>
                  <li><B>profileTokens</B>, <B>profileTokenHoldings</B>, <B>tokenUnlockStates</B>, <B>miningSessions</B></li>
                </ul>
              </SubCard>
              <SubCard title="Metrics & Verification Stores">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>qcmSamples</B> — Quantum metrics with compound <Code>userSeriesKey</Code> index</li>
                  <li><B>nodeMetricAggregates</B> — Triple compound index: <Code>[userId, metric, bucket]</Code> for time-series node health data</li>
                  <li><B>achievementDefinitions</B> — Unique <Code>slug</Code> index + <Code>category</Code> index</li>
                  <li><B>achievementProgress</B> — Compound <Code>userAchievementKey</Code> unique index for per-user progress tracking</li>
                  <li><B>verificationStates</B>, <B>verificationProofs</B> — Cryptographic proof storage with timestamp index</li>
                  <li><B>replicas</B> — Mesh replication tracking with <Code>redundancyTarget</Code> index</li>
                </ul>
              </SubCard>
              <SubCard title="Project Management Stores">
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>projects</B> — Collaborative project records</li>
                  <li><B>tasks</B> — Indexed by <Code>projectId</Code>, <Code>status</Code>, and <Code>assignees</Code> (multiEntry)</li>
                  <li><B>milestones</B> — Indexed by <Code>projectId</Code> and <Code>dueDate</Code></li>
                </ul>
              </SubCard>
            </div>
          </Section>

          {/* ─── ED25519 PRESENCE TICKETS ─── */}
          <Section title="Ed25519 Presence Tickets">
            <P>
              Standard P2P systems use simple heartbeats for presence. The Imagination Network implements <B>cryptographically signed presence tickets</B> — a protocol that has no equivalent in typical social or messaging applications:
            </P>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
              <li><B>Envelope Structure:</B> Version 1 envelopes contain: Ed25519 algorithm identifier, signer's public key, base64 signature, and a payload with peerId, userId, issuedAt, expiresAt, and a 12-byte cryptographic nonce.</li>
              <li><B>TTL & Clock Skew:</B> Tickets expire after 3 minutes (<Code>DEFAULT_TICKET_TTL_MS = 180,000</Code>) with 15-second clock skew tolerance for network latency.</li>
              <li><B>Canonical JSON Signing:</B> Payloads are serialized using deterministic canonical JSON before signing, ensuring byte-identical payloads across all implementations.</li>
              <li><B>Multi-Layer Validation:</B> Tickets are validated for: expiration, future-dating, peerId match, userId match, public key trust, and cryptographic signature integrity.</li>
              <li><B>Detached Signatures:</B> The system supports verifying detached signatures over arbitrary data using the same Ed25519 infrastructure, enabling content authenticity verification beyond presence.</li>
            </ul>
          </Section>

          {/* ─── ROOM DISCOVERY OVERLAY ─── */}
          <Section title="Room Discovery Overlay">
            <P>
              A <B>spatial discovery system</B> unique to this architecture — peers on the same application route automatically discover each other through a content-aware overlay:
            </P>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
              <li><B>FNV-1a Route Hashing:</B> The current <Code>window.location.pathname</Code> is hashed using a 32-bit FNV-1a algorithm to create a deterministic room identifier.</li>
              <li><B>SPA-Aware:</B> Browser history methods (<Code>pushState</Code>, <Code>replaceState</Code>) are patched to detect route changes without page reloads.</li>
              <li><B>Single-Hop Gossip Relay:</B> Room announcements propagate through intermediary connections with <Code>MAX_HOPS = 1</Code> and nonce-based deduplication.</li>
              <li><B>Isolated Peer Bridging:</B> For peers with zero connections, the overlay uses a <Code>BroadcastChannel</Code> for same-origin discovery and a PeerJS Rendezvous Beacon (<Code>rmbeacon-&#123;roomHash&#125;</Code>) for cross-tab contact.</li>
              <li><B>Non-Interfering:</B> Operates as a supplemental layer on top of the mesh cascade — never conflicts with the primary SWARM Mesh, Builder Mode, or Test Mode.</li>
            </ul>
          </Section>

          {/* ─── CONTENT SYSTEMS ─── */}
          <Section title="Content Systems">
            <div className="space-y-3">
              <SubCard title="Blog & Book Classification">
                <P>
                  Posts are automatically classified using content-aware heuristics. A post ≥ 1,000 characters that passes at least one signal check (has media, contains links, or exceeds 3,000 characters) is rendered as a <B>Blog</B> with hero image support and rich typography. Posts exceeding 250,000 characters are classified as <B>Books</B> and torrent-wrapped before serving.
                </P>
                <P>
                  Once classified, <Code>blogClassification</Code> and <Code>blogLocked</Code> flags are permanently set on the post, ensuring blog identity persists across peer sync, IndexedDB writes, and application restarts — blogs never revert to standard posts.
                </P>
              </SubCard>

              <SubCard title="Post Sync & Offline Queue">
                <P>
                  The post synchronization system implements patterns absent from standard social apps:
                </P>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li><B>Upsert Logic:</B> Incoming posts are compared by timestamp and content hash — only newer or changed content is written, preventing sync loops.</li>
                  <li><B>Signature Verification:</B> All synced posts are verified against their Ed25519 signatures. Unverified posts are accepted with diagnostic warnings during development.</li>
                  <li><B>Offline Post Queue:</B> Posts created while disconnected are persisted to localStorage and automatically flushed to all peers when connectivity is established. Failed deliveries are re-queued.</li>
                  <li><B>Author Profile Propagation:</B> Peer profiles (avatar, banner, display name) are extracted from synced post metadata and upserted into the local user store, enabling profile discovery without direct handshake.</li>
                  <li><B>Badge Snapshot Merging:</B> Achievement badges embedded in posts are merged using timestamp-based conflict resolution.</li>
                  <li><B>Asset Request Protocol:</B> Missing media attachments trigger explicit <Code>manifest_request</Code> and <Code>chunk_request</Code> messages, pulling data on-demand when passive sync fails.</li>
                </ul>
              </SubCard>

              <SubCard title="Entanglement System (Social Graph)">
                <P>
                  The social graph uses quantum-physics-inspired terminology: users "entangle" (follow) and "detangle" (unfollow). Each entanglement is stored with a compound <Code>userTargetKey</Code> for O(1) lookup, bidirectional index queries (<Code>getEntangledUserIds</Code> and <Code>getFollowerIds</Code>), and custom events (<Code>entanglements-updated</Code>) for real-time UI reactivity. Self-entanglement is explicitly prevented.
                </P>
              </SubCard>

              <SubCard title="NFT & Achievement Wrapping">
                <P>
                  Every post is inherently minted as an NFT on the local chain, with the full text wrapped as NFT metadata including media manifest IDs, MIME types, and filenames. Achievements and badges earned through platform activity are wrapped as NFTs with rarity attributes (common to legendary), QCM impact scores, credit reward values, and unlock timestamps.
                </P>
              </SubCard>

              <SubCard title="Streaming Rooms">
                <P>
                  WebRTC-based live audio/video rooms with a polite/impolite peer model for glare resolution (based on lexicographical Peer ID comparison). Recordings are chunked at 1 MiB, encrypted, and seeded to the swarm. Gun.js provides call recovery with 3 retry attempts per session. Room metadata syncs via the <Code>channel:stream-rooms</Code> protocol with 2-minute post-merge windows.
                </P>
              </SubCard>

              <SubCard title="Gossip Protocol">
                <P>
                  An epidemic-style gossip protocol broadcasts peer information across the network every 60 seconds, carrying up to 20 peers per message with a TTL of 3 hops. Messages that haven't exhausted their TTL are automatically re-broadcast with decremented TTL, ensuring eventual consistency of peer state across the entire distributed network.
                </P>
              </SubCard>
            </div>
          </Section>

          {/* ─── CREDIT ECONOMICS ─── */}
          <Section title="Credit Economics Engine">
            <P>
              The credit system implements a <B>full micro-economy</B> with rate limiting, daily caps, and event-driven achievement tracking — far exceeding typical reward point systems:
            </P>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
              <li><B>Genesis Allocation:</B> 100 credits on account creation (awarded exactly once via idempotent check).</li>
              <li><B>Earning Rates:</B> Posts: 1 credit. Comments: 0.2 credits (daily cap: 2 credits). Hosting: 1 credit per MB. Achievements: configurable per badge.</li>
              <li><B>Transfer Rate Limiting:</B> 5 transactions per 60-second window, 5,000 credits daily limit. Rate state is persisted in localStorage with automatic window rotation.</li>
              <li><B>Input Validation:</B> All transfers use Zod schemas: integer amounts, min 1 / max 10,000 credits, non-empty trimmed user IDs, max 240-character messages.</li>
              <li><B>Hype System:</B> 5-credit cost per hype action with 20% burn rate — credits spent on hype are partially destroyed, creating deflationary pressure.</li>
              <li><B>Daily Burn:</B> 0.3 credits burned daily via quantum metrics, providing ongoing deflationary balancing.</li>
              <li><B>Achievement Event Bus:</B> Every credit transaction asynchronously triggers achievement evaluation via <Code>evaluateAchievementEvent()</Code>, enabling chains like "earn → unlock badge → mint NFT → earn more."</li>
              <li><B>Real-Time Notifications:</B> Credit transactions dispatch <Code>credits:transaction</Code> CustomEvents with full metadata (direction, counterparty, amount, type) for immediate UI updates.</li>
            </ul>
          </Section>

          {/* ─── VERIFICATION PROOFS ─── */}
          <Section title="Cryptographic Verification Proofs">
            <P>
              Human verification uses a <B>Dream Match</B> game that generates cryptographic proofs without any centralized CAPTCHA service:
            </P>
            <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
              <li>Proof contains: userId, medal tier, entropy metrics (Shannon entropy + completion time + flip count), credits earned, public key, and timestamp.</li>
              <li>Signature is computed as <Code>SHA-256(JSON(proof + HMAC(entropy metrics)))</Code> — a nested hash that binds the proof to both the user's identity and their interaction pattern.</li>
              <li>Verification recomputes the signature independently and compares — any modification to any field invalidates the proof.</li>
              <li>Medal tiers (bronze, silver, gold) are awarded based on entropy thresholds, preventing scripted completion.</li>
            </ul>
          </Section>

          {/* ─── PLATFORM FEATURES ─── */}
          <Section title="Platform Features">
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><B>Offline-First:</B> All data persists locally in encrypted IndexedDB stores. The app works fully offline with dual automatic queuing: post sync queue + blockchain offline action log, both flushing when peers become available.</li>
              <li><B>Auto-Mining Service:</B> Background mining that runs while the app is open, earning SWARM tokens through CREATOR Proof consensus on the active chain.</li>
              <li><B>Quantum Metrics Panel:</B> Real-time visualization of UQRC curvature metrics (template, nonce, propagation, timestamp), daily token burn tracking, and total Q_Score.</li>
              <li><B>Unified Connection State:</B> A single <Code>p2p-connection-state</Code> store replaces fragmented legacy keys, with automatic migration, pub/sub listeners, and cross-component synchronization.</li>
              <li><B>Content Discovery:</B> Trending algorithms, explore feeds with filtering, and search — all powered entirely by peer-synced data with no centralized index.</li>
              <li><B>Project Management:</B> Task boards with <Code>multiEntry</Code> assignee indexes, milestones with due date sorting, and project collaboration tools — all encrypted and mesh-synced.</li>
              <li><B>4-Step Onboarding Wizard:</B> Credentials → Network Mode → Backup Phrase (with entropy meter) → Terms of Service (scroll-to-accept with 20px guard buffer). Nothing is stored until all steps complete.</li>
              <li><B>Account Export/Import:</B> Full account backup as versioned JSON (user meta + wrapped key), importable on any device with the password.</li>
              <li><B>Moderation Dashboard:</B> Community-driven moderation with peer scoring, alert summary cards, content flagging, and node blocklisting with persistent HMAC-protected storage.</li>
            </ul>
          </Section>

          {/* ─── TOKENOMICS ─── */}
          <Section title="SWARM Tokenomics">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border/30">
                  {[
                    ["Max Supply", "21,000,000 SWARM"],
                    ["Block Time", "30 seconds"],
                    ["Mining Difficulty", "4 (leading zeros)"],
                    ["Base Mining Reward", "50 SWARM per block"],
                    ["Halving Interval", "Every 210,000 blocks"],
                    ["Network Pool Tax", "5% of mining rewards"],
                    ["Transaction Processing Reward", "0.1 SWARM per confirmed action"],
                    ["Content Hosting Reward", "0.05 SWARM per service unit"],
                    ["Credit → SWARM Ratio", "100 credits = 1 SWARM (pool-dependent)"],
                    ["Cross-Chain Swap (sub ↔ sub)", "1:1"],
                    ["Cross-Chain Swap (sub → SWARM)", "2:1"],
                    ["Cross-Chain Swap (SWARM → sub)", "1:1"],
                    ["External Bridge Fee", "1% + 1 SWARM base"],
                    ["Creator Token Deploy Cost", "1,000 credits"],
                    ["Creator Token Max Supply", "10,000 per account"],
                    ["Token → Credits Swap", "1:1 (direct)"],
                    ["Token → SWARM Swap", "10:1 (10 tokens = 1 SWARM)"],
                    ["Token→SWARM Pool Surplus", "+1 SWARM (wrapper returned to pool)"],
                    ["Coin Deploy Cost", "10,000 SWARM total"],
                    ["Coin Liquidity Lock", "5,000 SWARM (floor value backing)"],
                    ["Coin Pool Contribution", "5,000 SWARM to community pool"],
                    ["MineHealth Gate", "All swaps, deploys, wraps require active mining + peers"],
                    ["Hype Cost", "5 credits (20% burned)"],
                    ["Hype Value", "10 Creator Tokens = 1 credit"],
                    ["Daily Burn", "0.3 credits via quantum metrics"],
                    ["Genesis Credits", "100 per new account"],
                    ["Post Reward", "1 credit"],
                    ["Comment Reward", "0.2 credits (daily cap: 2)"],
                    ["Transfer Limit", "5 txns/min, 5,000 credits/day"],
                    ["Tip Range", "1–500 credits per tip"],
                    ["PBKDF2 Key Wrapping", "200,000 iterations"],
                    ["PBKDF2 Backup Keys", "250,000 iterations"],
                    ["PBKDF2 Storage Keys", "100,000 iterations"],
                    ["Backup Chunk Size", "512 bytes"],
                    ["Content Chunk Size", "1 MiB (1,048,576 bytes)"],
                    ["Presence Ticket TTL", "3 minutes (15s clock skew)"],
                    ["UQRC Template Freeze", "750 ms window"],
                    ["Nonce Partitions", "256 zones (32-bit space)"],
                    ["Propagation Quorum", "2 peers minimum"],
                    ["Timestamp Max Drift", "60 seconds"],
                    ["Blockchain Sync Interval", "Every 2 minutes"],
                    ["Gossip Interval", "60s broadcast, TTL 3 hops, max 20 peers"],
                    ["Room Discovery Interval", "2-min broadcast, 3-min isolated scan"],
                    ["IndexedDB Version", "20 (20 object stores)"],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="py-2 pr-4 text-foreground/60 whitespace-nowrap">{label}</td>
                      <td className="py-2 font-medium text-foreground">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ─── TECH STACK ─── */}
          <Section title="Technology Stack">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Frontend", value: "React 18 + TypeScript + Vite" },
                { label: "Styling", value: "Tailwind CSS + shadcn/ui" },
                { label: "P2P Primary", value: "PeerJS Standalone Scripts (WebRTC)" },
                { label: "P2P Relay", value: "Gun.js (Manhattan relay + public peers)" },
                { label: "P2P Discovery", value: "PEX, Triangle Gossip, Epidemic TTL" },
                { label: "Crypto", value: "Web Crypto API (ECDH P-256, AES-256-GCM, Ed25519, PBKDF2, SHA-256)" },
                { label: "Storage", value: "IndexedDB (encrypted) + localStorage (crash snapshot)" },
                { label: "Blockchain", value: "Custom client-side multi-chain (SWARM + user sub-chains)" },
                { label: "Mining", value: "UQRC-optimized in-browser PoW with nonce partitioning" },
                { label: "Content Delivery", value: "Torrent swarming (1 MiB chunks, rarest-first, Gun fallback)" },
                { label: "Streaming", value: "WebRTC MediaStream + DataChannels + Gun recovery" },
                { label: "State", value: "React Query + Context API" },
                { label: "Identity", value: "Ed25519 keys, Never-Rotate peer IDs, PBKDF2-wrapped passphrases" },
                { label: "Content Bridge", value: "BroadcastChannel cross-mode sync + Gun relay" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-border/40 bg-muted/20 p-3"
                >
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className="text-sm font-medium text-foreground mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ─── ROADMAP ─── */}
          <Section title="Roadmap">
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>Group encryption for private mesh channels and project key distribution</li>
              <li>CRDT-based multi-device sync for conflict-free editing across devices</li>
              <li>Persistent relay supernodes for high-availability bootstrapping</li>
              <li>Cross-chain bridge to external blockchains (Ethereum, Solana)</li>
              <li>Tauri desktop application for native OS integration</li>
              <li>Mobile PWA optimization with background sync</li>
            </ul>
          </Section>

          <p className="text-xs text-muted-foreground pt-4 border-t border-border/40 italic">
            "To imagine is to remember what the universe forgot it could be."
          </p>
        </Card>
      </main>
    </div>
  );
};

export default Whitepaper;