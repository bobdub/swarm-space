import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Eye, Lock, Users, AlertTriangle, Server, Key, FileKey } from "lucide-react";
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

        <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6 md:p-10 space-y-10">
          <header>
            <h1 className="text-3xl font-bold font-display uppercase tracking-[0.18em] mb-2">Security & Privacy</h1>
            <p className="text-sm text-muted-foreground">What you need to know to stay safe</p>
          </header>

          {/* ─── HUMAN-READABLE SECTION ─── */}

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(174,59%,56%,0.12)]">
                <Eye className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">What You Need to Manage</h2>
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Swarm Space is <strong className="text-foreground">your responsibility</strong>. There is no "forgot password" email, no support team with a master key, and no server backup. This is by design — it means nobody except you can access your data. But it also means:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Your Recovery Key</strong> — a short code (like <code className="text-[hsl(174,59%,56%)]">SWRM-XXXX-XXXX</code>) that locates your backup on the mesh. Lose it and we cannot find your backup.</li>
              <li><strong className="text-foreground">Your Recovery Phrase</strong> — a poem, sentence, or phrase you chose. This "salts" your encryption. Without it, even with the key, your data stays locked.</li>
              <li><strong className="text-foreground">Your Password</strong> — used for day-to-day login. Combined with the phrase, it's part of the encryption that protects your identity.</li>
            </ul>
            <div className="rounded-xl border border-[hsla(38,92%,50%,0.25)] bg-[hsla(38,92%,50%,0.06)] p-4">
              <p className="text-sm text-foreground/80 leading-relaxed">
                <strong className="text-[hsl(38,92%,50%)]">💡 Think of it like this:</strong> Your recovery key is a locker number. Your phrase is the combination. Your password opens the box inside. You need all three.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(142,71%,45%,0.12)]">
                <Shield className="h-5 w-5 text-[hsl(142,71%,45%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Staying Safe Online</h2>
            </div>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Download your recovery key</strong> and store it somewhere safe — a notes app, a piece of paper, a USB drive. Not on the same device you browse on.</li>
              <li><strong className="text-foreground">Remember your phrase.</strong> Write it down privately. Don't use "password123" — use something personal and memorable.</li>
              <li><strong className="text-foreground">Don't share your key or phrase</strong> with anyone. No one from Swarm Space will ever ask for them.</li>
              <li><strong className="text-foreground">Use a strong password</strong> — at least 8 characters, ideally more. Unique to this app.</li>
              <li><strong className="text-foreground">Keep your browser updated.</strong> Security fixes in your browser protect your local data.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(326,71%,62%,0.12)]">
                <AlertTriangle className="h-5 w-5 text-[hsl(326,71%,62%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">No Site Can Promise "Unhackable"</h2>
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Any website or app that claims to be 100% hack-proof is misleading you. Security is a <strong className="text-foreground">spectrum, not a switch</strong>. Here's what we do and what we can't control:
            </p>
            <div className="grid gap-3">
              <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                <p className="text-sm font-semibold text-[hsl(142,71%,45%)]">✅ What we do</p>
                   <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-foreground/60">
                   <li>Encrypt everything with AES-256-GCM before it leaves your device</li>
                   <li>Never store your password or keys on any server</li>
                   <li>Use 250,000-iteration PBKDF2 to make brute-force attacks extremely slow</li>
                   <li>Sign content with Ed25519 so forgery is detectable</li>
                   <li>Vault-encrypt sensitive data in memory so browser extensions see only opaque blobs — not readable text</li>
                   <li>End-to-end encrypt signaling metadata (offers, answers, ICE) so relay servers see only ciphertext — even the server that helps you connect cannot read the connection details</li>
                   <li>Require active peer connections before mining starts — solo nodes cannot inflate the economy</li>
                   <li>Broadcast encrypted post and comment chunks directly to connected peers with verified peer identity</li>
                   <li>Open-source codebase — anyone can audit the security</li>
                 </ul>
              </div>
              <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                <p className="text-sm font-semibold text-[hsl(326,71%,62%)]">⚠️ What we can't control</p>
                <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-foreground/60">
                  <li>Malware on your device (keyloggers, screen capture)</li>
                  <li>Weak passwords you choose</li>
                  <li>Sharing your recovery key/phrase with others</li>
                  <li>Browser vulnerabilities (keep your browser updated)</li>
                  <li>Physical access to your unlocked device</li>
                  <li>Extensions with full page access (vault encryption makes scraping harder but not impossible for determined malware)</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(245,70%,60%,0.12)]">
                <Users className="h-5 w-5 text-[hsl(245,70%,60%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">The Mesh — Your Data, Your Peers</h2>
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              When you post content, encrypted pieces are shared with peers on the mesh. They hold the ciphertext but <strong className="text-foreground">cannot read it</strong> — only someone with the right keys can decrypt it. Think of peers as safety deposit boxes that hold your stuff but can't open it.
            </p>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Once content is on the mesh, copies may persist on peers even after you delete locally. This is how decentralized systems work — it's a trade-off for censorship resistance and availability.
            </p>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(174,59%,56%,0.12)]">
                <Server className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Zero Servers, Zero Collection</h2>
            </div>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>No analytics, no tracking pixels, no telemetry</li>
              <li>No cookies sent to external domains</li>
              <li>No user data transmitted to any server we control</li>
              <li>Connection metadata (peer IDs) is ephemeral and never logged</li>
              <li>The only "server" is a lightweight signaling relay that helps peers find each other — it never sees your content</li>
            </ul>
          </section>

          {/* ─── TECHNICAL SECTION ─── */}

          <div className="border-t border-border/40 pt-8">
            <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground mb-6">Technical Details</p>
          </div>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(174,59%,56%,0.12)]">
                <Key className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Recovery Key System (v2)</h2>
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Account recovery uses a <strong className="text-foreground">three-factor system</strong> where each component serves a distinct purpose:
            </p>
            <div className="space-y-3">
              {[
                {
                  title: "Recovery Key → Lookup Address",
                  desc: "An HMAC-derived tag (SWRM-XXXX format) that locates your encrypted backup chunks on the mesh. Contains no encrypted data — it's a locker number, not the combination.",
                },
                {
                  title: "Recovery Phrase → Encryption Salt",
                  desc: "A user-chosen phrase that salts the PBKDF2 key derivation. Without the phrase, the encryption key cannot be derived, even with the correct password.",
                },
                {
                  title: "Password → Decryption Key",
                  desc: "Combined with userId and phrase via PBKDF2 (250,000 iterations) to produce the AES-256-GCM key that decrypts the identity payload.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-border/40 bg-muted/20 p-4">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsla(174,59%,56%,0.12)]">
                <FileKey className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Encryption Standards</h2>
            </div>
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
                  title: "PBKDF2 Key Wrapping (250K iterations)",
                  desc: "Private keys are wrapped using password + userId + phrase via 250,000 PBKDF2 iterations, protecting against brute-force attacks.",
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
                <div key={item.title} className="rounded-xl border border-border/40 bg-muted/20 p-4">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">What Stays on Your Device</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Identity Keys:</strong> Ed25519 signing key and ECDH encryption keypair — generated locally, never leave your device unless you export a backup.</li>
              <li><strong className="text-foreground">Posts & Content:</strong> All posts, comments, reactions, and files stored in encrypted IndexedDB with HMAC integrity checks.</li>
              <li><strong className="text-foreground">Account Credentials:</strong> Password derives a wrapping key via PBKDF2. The password itself is never stored.</li>
              <li><strong className="text-foreground">Blockchain History:</strong> Transaction records and credit balances maintained in a local chain — no external ledger.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Your Rights</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Data Deletion:</strong> Clear browser storage to remove all local data. No server copy exists.</li>
              <li><strong className="text-foreground">Data Portability:</strong> Export your full account backup from Settings and import on another device.</li>
              <li><strong className="text-foreground">Consent Withdrawal:</strong> Revoke storage consent by clearing cookies.</li>
              <li><strong className="text-foreground">Transparency:</strong> The entire codebase is open-source under the Imagination License.</li>
            </ul>
          </section>

          <p className="text-xs text-muted-foreground pt-4 border-t border-border/40">
            This security & privacy document reflects the architecture as of March 2026. As the network evolves, this document will be updated accordingly.
          </p>
        </Card>
      </main>
    </div>
  );
};

export default Privacy;
