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
            <p className="text-sm text-muted-foreground">Imagination Network — Technical Overview</p>
          </header>

          {/* Vision */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Vision</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The Imagination Network is a decentralized, offline-first social architecture that empowers creators, researchers, and builders to collaborate without relying on centralized servers. Every participant's device is a sovereign node — hosting, sharing, and discovering content through a peer-to-peer mesh that prioritizes privacy, resilience, and creative freedom.
            </p>
          </section>

          {/* P2P Networking */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Hybrid P2P Transport</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The network employs a multi-layered transport system that combines several P2P technologies for maximum resilience:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">WebRTC DataChannels:</strong> Direct peer-to-peer connections for low-latency data exchange between nodes.</li>
              <li><strong className="text-foreground">Gun.js Mesh Relay:</strong> A decentralized signaling and data synchronization layer that works across difficult NAT scenarios and provides offline-first capabilities.</li>
              <li><strong className="text-foreground">WebTorrent DHT:</strong> Distributed hash table for peer discovery and large content distribution (recordings, files) using torrent-style chunk transfer.</li>
              <li><strong className="text-foreground">PeerJS Fallback:</strong> Cloud-assisted WebRTC signaling maintained for backward compatibility when mesh routing is unavailable.</li>
            </ul>
            <p className="text-sm text-foreground/70 leading-relaxed">
              An adaptive routing engine learns transport reliability over time, automatically falls back through layers, and recovers via circuit-breaker patterns — ensuring content reaches peers even under adverse network conditions.
            </p>
          </section>

          {/* Blockchain */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">On-Device Blockchain</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Every user action — posts, comments, reactions, file uploads, credit transfers — is inherently recorded as a transaction on a lightweight, client-side multi-chain blockchain. This provides:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Immutable Audit Trail:</strong> All content operations are cryptographically chained with SHA-256 block hashes.</li>
              <li><strong className="text-foreground">Credit Economy:</strong> An internal token system (Imagination Credits) with mining rewards, peer transfers, and burn mechanics.</li>
              <li><strong className="text-foreground">NFT Minting:</strong> Creators can mint posts and images as NFTs recorded on the local chain.</li>
              <li><strong className="text-foreground">Profile Tokens:</strong> Personalized tokens that represent creator identity and can be traded or held by supporters.</li>
              <li><strong className="text-foreground">Cross-Chain Sync:</strong> Blockchain state is synchronized across the P2P mesh, with conflict resolution based on chain length and timestamp consensus.</li>
            </ul>
          </section>

          {/* Encryption */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Encryption Architecture</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Content flows through three encryption stages before storage or transmission:
            </p>
            <ol className="list-decimal pl-5 space-y-3 text-sm text-foreground/70 leading-relaxed">
              <li>
                <strong className="text-foreground">Stage A — Public Key Encryption:</strong> Content is salted, hashed (SHA-256), and encrypted using ECDH (P-256) key exchange with AES-256-GCM. Each message carries a unique ephemeral key and initialization vector.
              </li>
              <li>
                <strong className="text-foreground">Stage B — Secure Chunking:</strong> Encrypted payloads are split into signed chunks with Ed25519 peer signatures, chunk hashes, and Merkle proofs for integrity verification.
              </li>
              <li>
                <strong className="text-foreground">Stage C — Blockchain Encryption:</strong> Chunks are further encrypted using a key derived from the latest block hash (PBKDF2 + AES-256-GCM), binding content to blockchain state.
              </li>
            </ol>
          </section>

          {/* Features */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Core Features</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Offline-First:</strong> All data persists locally in encrypted IndexedDB stores. The app works fully offline and syncs when peers are available.</li>
              <li><strong className="text-foreground">Live Streaming:</strong> WebRTC-based audio/video rooms with recording capabilities. Recordings are automatically seeded to the torrent swarm for peer replay.</li>
              <li><strong className="text-foreground">Content Discovery:</strong> Trending algorithms, explore feeds, and search powered entirely by peer-synced data — no centralized index.</li>
              <li><strong className="text-foreground">Project Management:</strong> Built-in task boards, milestones, and project collaboration tools — all encrypted and mesh-synced.</li>
              <li><strong className="text-foreground">Verification System:</strong> A gamified "Dream Match" verification flow that proves human presence without centralized CAPTCHA services.</li>
              <li><strong className="text-foreground">Moderation:</strong> Community-driven moderation with peer scoring, content flagging, and node isolation for policy violations.</li>
            </ul>
          </section>

          {/* Tech Stack */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Technology Stack</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Frontend", value: "React 18 + TypeScript + Vite" },
                { label: "Styling", value: "Tailwind CSS + shadcn/ui" },
                { label: "P2P Layer", value: "PeerJS, Gun.js, WebTorrent" },
                { label: "Crypto", value: "Web Crypto API (ECDH, AES-GCM, Ed25519)" },
                { label: "Storage", value: "IndexedDB (encrypted) + localStorage" },
                { label: "Blockchain", value: "Custom client-side multi-chain" },
                { label: "Streaming", value: "WebRTC MediaStream + DataChannels" },
                { label: "State", value: "React Query + Context API" },
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

          {/* Future */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Roadmap</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>Group encryption for private mesh channels</li>
              <li>CRDT-based multi-device sync for conflict-free editing</li>
              <li>Persistent relay supernodes for high-availability bootstrapping</li>
              <li>Cross-chain bridge to external blockchains (Ethereum, Solana)</li>
              <li>Token trading marketplace and NFT storefront</li>
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
