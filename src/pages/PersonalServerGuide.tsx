import { useNavigate } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Server, HardDrive, Shield, Lock, Globe, CheckCircle2, AlertTriangle, Settings as SettingsIcon, HelpCircle } from "lucide-react";

const Step = ({ number, title, children }: { number: number; title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
        {number}
      </div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
    </div>
    <div className="pl-11 space-y-3">{children}</div>
  </section>
);

const P = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={`text-sm text-foreground/80 leading-relaxed${className ? ` ${className}` : ""}`}>{children}</p>
);

const Callout = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-sm font-semibold text-foreground">{title}</span>
    </div>
    <p className="text-sm text-foreground/80 leading-relaxed">{children}</p>
  </div>
);

const PersonalServerGuidePage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground">
              Bring Your Own Server
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              A beginner-friendly guide to linking your personal storage server to the Imagination Network.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-8 bg-card border-border/40">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">What is a personal server?</h2>
              </div>
            </div>
            <P>
              A personal server is storage <strong>you</strong> own and control. It can be a tiny computer at home,
              a VPS in the cloud, or an S3-compatible bucket from a service like Cloudflare R2, Backblaze B2, or MinIO.
              Instead of relying only on the mesh to remember your files, you add a private backup node that answers only to you.
            </P>
            <P>
              The app never sends plaintext, keys, or identity material to your server. Every file chunk is encrypted
              on your device first and then uploaded as unreadable ciphertext. Your server is a vault whose contents
              are mathematically impossible to open without your private key.
            </P>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Why link one?</h2>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Callout icon={Shield} title="For you: stronger resilience">
                If your device is offline, your personal server can still serve your encrypted chunks to the mesh.
                You keep a redundant copy that is always under your control.
              </Callout>
              <Callout icon={Globe} title="For the network: healthier mesh">
                Optional public pinning lets your server re-seed other users' encrypted, signature-verified chunks,
                making the whole network faster and more reliable without exposing anyone's private data.
              </Callout>
              <Callout icon={Lock} title="For you: privacy by design">
                Your server stores only ciphertext and content hashes. Keys stay in the app's in-memory vault and
                disappear when the tab closes.
              </Callout>
              <Callout icon={CheckCircle2} title="For the network: decentralized growth">
                More personal servers means less reliance on any single provider. Every new server strengthens the
                distributed fabric of the Imagination Network.
              </Callout>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                <SettingsIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">How to add your server</h2>
              </div>
            </div>

            <Step number={1} title="Open the Storage settings">
              <P>
                Go to <strong>Settings → Storage</strong> and look for the <em>Personal Servers</em> section.
                Tap <strong>Add server</strong> to start the wizard.
              </P>
            </Step>

            <Step number={2} title="Choose your server kind">
              <P>
                Pick the adapter that matches your server:
              </P>
              <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
                <li><strong>HTTPS blob</strong> — a simple self-hosted REST server. Great for home servers, NAS devices, or small VPS.</li>
                <li><strong>S3-compatible</strong> — Cloudflare R2, Backblaze B2, MinIO, AWS S3, or any bucket that speaks the S3 API.</li>
              </ul>
            </Step>

            <Step number={3} title="Enter the connection details">
              <P>
                Give your server a friendly name, then paste the HTTPS URL or S3 endpoint. For HTTPS blob servers,
                paste the bearer token your server generated. For S3-compatible buckets, enter the bucket name,
                region, access key, and secret key.
              </P>
              <Callout icon={AlertTriangle} title="HTTPS only, except localhost">
                The app rejects plain <code className="text-xs">http://</code> URLs for safety. The only exception is
                <code className="text-xs">http://localhost</code> or <code className="text-xs">127.0.0.1</code> for local testing.
              </Callout>
            </Step>

            <Step number={4} title="Run the connection test">
              <P>
                Tap <strong>Test connection</strong>. The app will write a tiny encrypted probe chunk, read it back,
                verify its hash, and delete it. If the probe succeeds, you can continue.
              </P>
              <P className="text-muted-foreground">
                If the probe fails, check that your CORS policy allows the app origin, that your token or keys are correct,
                and that your bucket permissions allow PUT, GET, HEAD, and DELETE.
              </P>
            </Step>

            <Step number={5} title="Choose your scope and capacity">
              <P>
                Decide whether this server is a <strong>Private replica</strong> (your encrypted data only) or a
                <strong>Public pinning</strong> node (also re-seeds others' encrypted chunks). Set a storage cap in GiB.
                You can pause or remove the server at any time from the same settings panel.
              </P>
            </Step>

            <Step number={6} title="Link and go">
              <P>
                Tap <strong>Link server</strong>. Your credentials are sealed into the in-memory vault, and only the
                sealed blob is saved locally. Raw tokens or secrets never touch localStorage or IndexedDB in plaintext.
              </P>
              <Callout icon={HelpCircle} title="Relinking after a fresh tab">
                Because credentials live only in memory, you will need to re-enter them if you close and reopen the
                app. The server list and metadata are preserved; just tap the server and re-enter the token or keys.
              </Callout>
            </Step>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Security at a glance</h2>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-foreground/80">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>Encrypt-before-upload — every chunk is signed and encrypted before leaving your device.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>Keys stay in the in-memory vault and are not exportable.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>Signature gate on every read — corrupted or tampered chunks are rejected automatically.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>Public pinning is opt-in and only handles already-encrypted, verified content.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>Usage writebacks are throttled to keep the network calm.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border/40 bg-muted/20 p-4 text-center space-y-2">
            <p className="text-sm text-foreground/80">
              Ready to link your first server?
            </p>
            <Button className="gap-2" onClick={() => navigate("/settings")}>
              <SettingsIcon className="w-4 h-4" />
              Open Settings
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default PersonalServerGuidePage;
