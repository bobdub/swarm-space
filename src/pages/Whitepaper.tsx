import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
            <p className="text-sm text-muted-foreground">Imagination Network — Technical Overview v2.0</p>
          </header>

          {/* Vision */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Vision</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The Imagination Network is a decentralized, offline-first social architecture where every participant's device is a sovereign node. It combines peer-to-peer mesh networking, a client-side multi-chain blockchain, and end-to-end encryption to deliver a platform where creators, researchers, and builders collaborate without centralized servers. Content, identity, credits, and distribution are entirely user-owned — hosted, shared, and discovered through a resilient mesh that prioritizes privacy, creative freedom, and network honesty.
            </p>
          </section>

          {/* Three-Tier P2P Architecture */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Three-Tier P2P Architecture</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The network operates through three mutually exclusive standalone modes. Only one mode runs at a time to prevent PeerJS identity collisions. Transitioning between modes includes a 2,500 ms cooldown to allow signaling servers to release session IDs. All modes enforce a <strong className="text-foreground">Never-Rotate</strong> identity policy — each node keeps the persistent ID <code className="text-xs bg-muted/30 px-1 rounded">peer-&#123;nodeId&#125;</code> across sessions.
            </p>

            <div className="space-y-5">
              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">1. SWARM Mesh — Production Mode</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  The automated, production-ready mode uses a three-phase <strong className="text-foreground">Cascade Connect</strong> strategy:
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/70">
                  <li><strong className="text-foreground">Bootstrap:</strong> Hardcoded seed nodes are dialled first. A Phase 1b retry targets peers returning "peer-unavailable" errors after a brief settle period.</li>
                  <li><strong className="text-foreground">Library:</strong> Previously successful peers stored in the Connection Library are reconnected.</li>
                  <li><strong className="text-foreground">Manual Fallback:</strong> Users can paste a peer ID for direct connection.</li>
                </ol>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  SWARM Mesh features <strong className="text-foreground">Peer List Exchange (PEX)</strong> and <strong className="text-foreground">Triangle Gossip</strong> — when Peer A connects to Peer C, it re-broadcasts its library to Peer B, ensuring B and C discover and connect to each other regardless of application route. Presence broadcasts occur every 10 seconds.
                </p>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">2. Builder Mode — Manual Orchestration</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  A manual interface for creating private or controlled mesh environments. Governed by seven interlocked controls: Build a Mesh, Blockchain Sync, Auto-connect, Approve Only (high-privacy handshake gating), Torrent Serving, Mining, and Swarm Accept. When Blockchain Sync is disabled, all crypto features (NFTs, mining, credits, tips) are deactivated.
                </p>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">3. Test Mode — Stability Cornerstone</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  The foundational reference architecture from which all other modes derive. Implements a dynamic reconnection lifecycle (15 s → 30 s → 60 s). If all attempts fail, the network flag is disabled and the user is prompted to refresh. Maintains a persistent Connection Library for auto-dialling known peers and syncs content with the main feed via the global <code className="text-xs bg-muted/30 px-1 rounded">p2p-posts-updated</code> event bridge.
                </p>
              </div>
            </div>
          </section>

          {/* Blockchain */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">On-Device Multi-Chain Blockchain</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Every user action — posts, comments, reactions, file uploads, credit transfers — is inherently recorded as a transaction on a lightweight, client-side blockchain. The system supports multiple chains:
            </p>

            <div className="space-y-3">
              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">SWARM Main Chain</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>SHA-256 block hashes with Merkle root integrity</li>
                  <li>30-second block time, difficulty 4, mining reward 50 SWARM</li>
                  <li>Halving every 210,000 blocks — max supply 21,000,000 SWARM</li>
                  <li>5% network pool mining tax on all rewards</li>
                  <li>Cross-chain sync via P2P mesh with length + timestamp consensus</li>
                </ul>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">User-Deployed Sub-Chains (Coins)</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>Deploy cost: 10,000 SWARM (funds go to community pool)</li>
                  <li>Independent ledger tagged with chain ID & ticker</li>
                  <li>Cross-chain swaps: 1:1 between sub-chains, 2:1 when swapping to SWARM</li>
                  <li>Mining is context-aware — rewards accrue on the active chain</li>
                </ul>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">Creator Tokens</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/70">
                  <li>One per account, fixed max supply of 10,000 tokens</li>
                  <li>Deployment cost: 1,000 credits</li>
                  <li>Unlocked gradually at 10 tokens per 1 credit earned</li>
                  <li>10 Creator Tokens carry a "hype" value equivalent to 1 credit</li>
                  <li>Once used to lock an NFT post, the token cannot be renamed or redeployed</li>
                </ul>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">Credit Wrapping</h3>
                <p className="text-sm text-foreground/70">
                  100 Imagination Credits lock into 1 SWARM token via the community pool. Credits are the internal utility currency earned through content creation, engagement, and mining.
                </p>
              </div>
            </div>
          </section>

          {/* CREATOR Proof Mining */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">CREATOR Proof Mining</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              <strong className="text-foreground">CREATOR</strong> — <em>Content Rendering Empowering Action Through Our Realm</em> — is the consensus mechanism that transforms block production into "Honest Mining," an active network-stabilizing pulse strictly gated by peer connectivity.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Connectivity Gate:</strong> Rewards only accumulate when the node is online and has active peer connections. Disconnected nodes see a "Not Mining" status.</li>
              <li><strong className="text-foreground">Content Verification:</strong> Blocks must be verified by local content activity (seeding/receiving) and confirmed via mesh consensus (majority peer votes) before being awarded.</li>
              <li><strong className="text-foreground">Hollow Block Penalty:</strong> Blocks produced without active content rendering are flagged as "hollow" and receive a 50% reward reduction.</li>
              <li><strong className="text-foreground">Enriched Broadcasts:</strong> Mining broadcasts include metadata (peerCount, blockHeight, PEX data) and are acknowledged with <code className="text-xs bg-muted/30 px-1 rounded">mining-ack</code> for RTT measurement.</li>
              <li><strong className="text-foreground">Energized Priority:</strong> Actively mining peers receive priority in reconnection and extended liveness thresholds (60 s vs 30 s).</li>
              <li><strong className="text-foreground">Peer Connection Reward Removed:</strong> Connecting alone does not earn — only confirmed mesh work (transaction processing, content hosting) is rewarded.</li>
            </ul>
          </section>

          {/* Encryption */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Encryption Architecture V2</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Content flows through a four-stage pipeline before storage or transmission:
            </p>
            <ol className="list-decimal pl-5 space-y-3 text-sm text-foreground/70 leading-relaxed">
              <li>
                <strong className="text-foreground">Stage A — Sign & Encrypt:</strong> Content is salted, hashed (SHA-256), signed with Ed25519, and encrypted using ECDH (P-256) key exchange with AES-256-GCM. Each message carries a unique ephemeral key and initialization vector.
              </li>
              <li>
                <strong className="text-foreground">Stage B — Chunk for Mesh:</strong> Encrypted payloads are split into 64 KB signed chunks with Ed25519 peer signatures, chunk hashes, and Merkle proofs for integrity verification. Large payloads (250 K+) are torrent-wrapped for DHT distribution.
              </li>
              <li>
                <strong className="text-foreground">Stage C — ECDH Transport Encryption:</strong> Chunks are further encrypted during transit using per-peer ECDH key agreement, binding content to the specific transport session.
              </li>
              <li>
                <strong className="text-foreground">Stage D — Local Signed Plaintext:</strong> On the receiving node, content is decrypted and stored locally as signed plaintext in encrypted IndexedDB stores, ready for immediate rendering. Public content follows a simplified path that skips Stage A encryption but retains signing and chunking.
              </li>
            </ol>
          </section>

          {/* Content Systems */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Content Systems</h2>

            <div className="space-y-3">
              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">Blog & Book Classification</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Posts are automatically classified using content-aware heuristics. A post ≥ 1,000 characters that passes at least one check (has media, contains links, or exceeds 3,000 characters) is rendered as a <strong className="text-foreground">Blog</strong> with hero image support and rich typography. Posts exceeding 250,000 characters are classified as <strong className="text-foreground">Books</strong> and torrent-wrapped before serving.
                </p>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Once classified, <code className="text-xs bg-muted/30 px-1 rounded">blogClassification</code> and <code className="text-xs bg-muted/30 px-1 rounded">blogLocked</code> flags are permanently set on the post, ensuring blog identity persists across peer sync, IndexedDB writes, and application restarts — blogs never revert to standard posts.
                </p>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">NFT & Achievement Wrapping</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Creators can mint posts and images as NFTs recorded on the local chain. Achievements and badges earned through platform activity can be wrapped as NFTs with rarity attributes, creating a permanent on-chain record of accomplishments. Achievement sigils are displayed in profile galleries.
                </p>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <h3 className="text-sm font-bold text-foreground">Streaming Rooms</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  WebRTC-based live audio/video rooms with invite controls and recording capabilities. Recordings are automatically chunked, encrypted, and seeded to the torrent swarm for peer replay. Stream notifications propagate through the mesh in real time.
                </p>
              </div>
            </div>
          </section>

          {/* Core Features */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Platform Features</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Offline-First:</strong> All data persists locally in encrypted IndexedDB stores. The app works fully offline and syncs when peers are available.</li>
              <li><strong className="text-foreground">Auto-Mining Service:</strong> Background mining that runs while the app is open, earning SWARM tokens through CREATOR Proof consensus.</li>
              <li><strong className="text-foreground">Quantum Metrics Panel:</strong> Real-time visualization of mining curvature metrics, daily token burn tracking, and network health indicators.</li>
              <li><strong className="text-foreground">Content Discovery:</strong> Trending algorithms, explore feeds with filtering, and search — all powered entirely by peer-synced data with no centralized index.</li>
              <li><strong className="text-foreground">Project Management:</strong> Task boards, milestones, and project collaboration tools — all encrypted and mesh-synced.</li>
              <li><strong className="text-foreground">Dream Match Verification:</strong> A gamified verification flow that proves human presence without centralized CAPTCHA services.</li>
              <li><strong className="text-foreground">Moderation Dashboard:</strong> Community-driven moderation with peer scoring, alert summary cards, content flagging, and node isolation for policy violations.</li>
              <li><strong className="text-foreground">Onboarding Walkthrough:</strong> Guided multi-step onboarding with browser detection, storage health checks, and feature introduction.</li>
              <li><strong className="text-foreground">Account Recovery:</strong> Passphrase backup with PBKDF2 key wrapping, mesh backup protocol, and full account export/import.</li>
              <li><strong className="text-foreground">Cookie Consent:</strong> GDPR-compliant consent banner with granular storage preferences.</li>
            </ul>
          </section>

          {/* Economics */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">SWARM Tokenomics</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border/30">
                  {[
                    ["Max Supply", "21,000,000 SWARM"],
                    ["Block Time", "30 seconds"],
                    ["Mining Difficulty", "4"],
                    ["Base Mining Reward", "50 SWARM per block"],
                    ["Halving Interval", "Every 210,000 blocks"],
                    ["Network Pool Tax", "5% of mining rewards"],
                    ["Credit → SWARM Ratio", "100 credits = 1 SWARM"],
                    ["Cross-Chain Swap (sub ↔ sub)", "1:1"],
                    ["Cross-Chain Swap (sub → SWARM)", "2:1"],
                    ["Creator Token Deploy Cost", "1,000 credits"],
                    ["Creator Token Max Supply", "10,000 per account"],
                    ["Coin Deploy Cost", "10,000 SWARM"],
                    ["Hype Value", "10 Creator Tokens = 1 credit"],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="py-2 pr-4 text-foreground/60 whitespace-nowrap">{label}</td>
                      <td className="py-2 font-medium text-foreground">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Tech Stack */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Technology Stack</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Frontend", value: "React 18 + TypeScript + Vite" },
                { label: "Styling", value: "Tailwind CSS + shadcn/ui" },
                { label: "P2P Layer", value: "PeerJS Standalone Scripts (WebRTC)" },
                { label: "Crypto", value: "Web Crypto API (ECDH, AES-GCM, Ed25519, PBKDF2)" },
                { label: "Storage", value: "IndexedDB (encrypted) + localStorage" },
                { label: "Blockchain", value: "Custom client-side multi-chain (SWARM + sub-chains)" },
                { label: "Streaming", value: "WebRTC MediaStream + DataChannels" },
                { label: "State", value: "React Query + Context API" },
                { label: "Identity", value: "Ed25519 presence tickets, Never-Rotate peer IDs" },
                { label: "Content Delivery", value: "Torrent-style chunk transfer (64 KB, Merkle proofs)" },
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
          </section>

          {/* Roadmap */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Roadmap</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>Group encryption for private mesh channels and project key distribution</li>
              <li>CRDT-based multi-device sync for conflict-free editing across devices</li>
              <li>Persistent relay supernodes for high-availability bootstrapping</li>
              <li>Cross-chain bridge to external blockchains (Ethereum, Solana)</li>
              <li>Tauri desktop application for native OS integration</li>
              <li>Mobile PWA optimization with background sync</li>
            </ul>
          </section>

          <p className="text-xs text-muted-foreground pt-4 border-t border-border/40 italic">
            "To imagine is to remember what the universe forgot it could be."
          </p>
        </Card>
      </main>
    </div>
  );
};

export default Whitepaper;
