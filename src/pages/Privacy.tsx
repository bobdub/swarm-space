import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Privacy = () => {
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
            <h1 className="text-3xl font-bold font-display uppercase tracking-[0.18em] mb-2">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">How Swarm Space protects your data</p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Our Privacy Principles</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Swarm Space is built on a zero-knowledge, offline-first architecture. Your data never passes through centralized servers. There is no cloud database, no analytics platform, and no third-party tracking. Everything is stored locally on your device and shared only through the encrypted peer-to-peer mesh that you control.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">What Data Stays on Your Device</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Identity Keys:</strong> Your Ed25519 signing key and ECDH encryption keypair are generated locally and never leave your device unless you explicitly export a backup.</li>
              <li><strong className="text-foreground">Posts & Content:</strong> All posts, comments, reactions, and files are stored in encrypted IndexedDB stores protected by HMAC integrity checks.</li>
              <li><strong className="text-foreground">Account Credentials:</strong> Your password is used to derive a wrapping key (PBKDF2, 100K iterations) that encrypts your private key. The password itself is never stored.</li>
              <li><strong className="text-foreground">Preferences & Settings:</strong> Theme choices, notification preferences, and UI state are saved in localStorage on your device.</li>
              <li><strong className="text-foreground">Blockchain History:</strong> Transaction records and credit balances are maintained in a local chain — no external ledger is involved.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Encryption Standards</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              All user content is encrypted through a multi-stage pipeline before it touches the network or local storage:
            </p>
            <div className="space-y-3">
              {[
                {
                  title: "ECDH P-256 + AES-256-GCM",
                  desc: "Content is encrypted with a shared secret derived from ephemeral ECDH key exchange. Each message uses a unique salt, IV, and content hash.",
                },
                {
                  title: "Ed25519 Signatures",
                  desc: "Every post and chunk carries a digital signature proving it was authored by the claimed identity. Forgery is computationally infeasible.",
                },
                {
                  title: "PBKDF2 Key Wrapping",
                  desc: "Private keys are wrapped with a password-derived key using 100,000 PBKDF2 iterations, protecting against brute-force attacks.",
                },
                {
                  title: "HMAC Integrity",
                  desc: "All local storage reads are verified with HMAC checks. If data has been tampered with via browser DevTools or disk editing, it is automatically rejected.",
                },
                {
                  title: "Blockchain-Layer Encryption",
                  desc: "P2P chunks are additionally encrypted with a key derived from the latest block hash, binding content integrity to the blockchain state.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-border/40 bg-muted/20 p-4"
                >
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Peer-to-Peer Data Sharing</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              When you publish content, encrypted chunks are broadcast to connected peers via WebRTC, Gun.js mesh relay, or WebTorrent DHT. Peers receive only ciphertext — they cannot read your content without your private key. Content you mark as public is encrypted for transit but decryptable by recipients using your published public key.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">No External Data Collection</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>No analytics or telemetry services are embedded in the application.</li>
              <li>No cookies are sent to external domains.</li>
              <li>No user data is transmitted to any server controlled by the Imagination Network.</li>
              <li>Connection metadata (peer IDs, transport types) used for mesh routing is ephemeral and not logged.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Your Rights</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Data Deletion:</strong> Clear your browser storage at any time to remove all local data. Since no data is stored on external servers, deletion is immediate and complete.</li>
              <li><strong className="text-foreground">Data Portability:</strong> Export your full account backup (encrypted JSON) from Settings at any time and import it on another device.</li>
              <li><strong className="text-foreground">Consent Withdrawal:</strong> Revoke storage consent by clearing cookies. The app will re-prompt on next visit.</li>
              <li><strong className="text-foreground">Transparency:</strong> The entire codebase is open-source under the Imagination License. You can audit every line of code that touches your data.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Content on the Mesh</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Once content is shared with the peer mesh, copies may be cached by connected peers. You can delete content locally and broadcast a deletion request, but previously replicated copies may persist until peers synchronize. This is an inherent property of decentralized systems and not a failure of privacy controls.
            </p>
          </section>

          <p className="text-xs text-muted-foreground pt-4 border-t border-border/40">
            This privacy policy reflects the architecture as of March 2025. As the network evolves, this document will be updated accordingly.
          </p>
        </Card>
      </main>
    </div>
  );
};

export default Privacy;
