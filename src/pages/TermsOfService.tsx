import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const TermsOfService = () => {
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
            <h1 className="text-3xl font-bold font-display uppercase tracking-[0.18em] mb-2">Terms of Service</h1>
            <p className="text-sm text-muted-foreground">Last Updated: March 2025</p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">1. Introduction</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The Imagination Network is a private, peer-to-peer, offline-first collaboration mesh designed for creators, researchers, and builders. Access to the network is provided through Swarm-Space at swarm-space.lovable.app and through community-operated gateways. These Terms of Service ("Terms") govern your participation. By using any portal or node that connects to the network you accept these Terms and agree to uphold the ethics of decentralized collaboration.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">2. Key Definitions</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li><strong className="text-foreground">Imagination Network:</strong> The distributed peer-to-peer ecosystem governed by these Terms.</li>
              <li><strong className="text-foreground">Swarm-Space:</strong> The web gateway at swarm-space.lovable.app that interfaces with the Imagination Network.</li>
              <li><strong className="text-foreground">Node:</strong> Any device or service participating in peer-based communication or hosting content.</li>
              <li><strong className="text-foreground">User / Creator:</strong> Any person engaging with the network, whether hosting a node or connecting through a gateway.</li>
              <li><strong className="text-foreground">Fork / Instance:</strong> A self-hosted or modified version of the Imagination Network software.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">3. Eligibility and Accounts</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Participation is open to individuals who can legally enter into binding agreements within their jurisdiction. You are responsible for ensuring that your use of cryptography, peer-to-peer networking, and distributed storage complies with applicable laws. Any credentials issued are personal to you and must not be shared. You remain responsible for the security of your node, keys, and access tokens.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">4. Nature of the Network</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The Imagination Network functions as a peer-to-peer mesh, not a traditional centralized platform. Each participant's node acts as a sovereign space capable of hosting, sharing, and supporting others without reliance on a single service provider. Availability may fluctuate as peers join or leave, and data replicated across nodes may persist beyond your direct control until peers synchronize updates.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">5. User Responsibilities</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70 leading-relaxed">
              <li>Act with integrity, care, and respect toward others.</li>
              <li>Refrain from illegal, abusive, or exploitative activity.</li>
              <li>Protect your node data, cryptographic keys, and connection privacy.</li>
              <li>Honor project ownership, consent boundaries, and licensing terms.</li>
              <li>Report suspected security issues responsibly.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">6. Prohibited Conduct</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The network operates on mutual trust. Prohibited behaviors include harassment, discrimination, or targeted abuse; disseminating malware or malicious code; attempting to deanonymize participants without consent; spamming or resource exhaustion attacks; and misrepresenting affiliation or impersonating other creators. Violations may trigger community enforcement actions.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">7. Cookies & Local Storage</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              This application uses local storage and cookies to save your account, preferences, and encrypted mesh data. No data is sent to external servers — everything stays on your device and the peer network. By accepting the storage consent banner, you agree to the use of IndexedDB, localStorage, and session cookies for authentication, identity persistence, encrypted key storage, and peer mesh coordination. You may clear this data at any time through your browser settings; doing so will sign you out and remove locally cached content.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">8. Intellectual Property</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              Creators retain all rights to their original content. By sharing publicly you grant the network a non-exclusive, worldwide license to transmit, cache, and reproduce your content within the swarm for availability and discovery. You may revoke that license by deleting or isolating your content, though previously replicated copies may persist until peers sync. Software components are released under the Imagination License.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">9. Limitation of Liability</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              The project is provided "as is." No warranty is expressed or implied regarding availability, reliability, or fitness for a particular purpose. To the fullest extent permitted by law, the Imagination Network, its contributors, and moderators are not liable for indirect, incidental, special, consequential, or punitive damages, or loss of data, profits, goodwill, or other intangible losses. Your sole remedy for dissatisfaction is to discontinue participation or operate an independent fork.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">10. Changes to These Terms</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              These Terms evolve alongside the network. Material updates will be distributed through Swarm-Space. Continued participation after notice of changes constitutes acceptance of the revised Terms. If you object to any update you may cease participation or operate under an alternative fork.
            </p>
          </section>

          <p className="text-xs text-muted-foreground pt-4 border-t border-border/40">
            By accessing the Imagination Network you affirm that you have read, understood, and agree to these Terms of Service.
          </p>
        </Card>
      </main>
    </div>
  );
};

export default TermsOfService;
