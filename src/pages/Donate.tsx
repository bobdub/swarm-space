import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Code2,
  Globe,
  Users,
  Gift,
  Wallet,
  Coins,
  CreditCard,
  ExternalLink,
  Copy,
  Check,
  Heart,
  HandCoins,
  Shield,
  Sparkles,
  Cpu,
  Network,
  Server,
  Github,
  Coffee,
  Bitcoin,
} from "lucide-react";

const EMAIL = "tbk@bobdub.rocks";
const LOVABLE_URL = "https://lovable.dev/pricing";
const MINTME_URL = "https://www.mintme.com/token/MTCG/ETH/trade";

type Platform = {
  name: string;
  icon: React.ElementType;
  description: string;
  href?: string;
};

const RECOMMENDED: Platform[] = [
  { name: "Liberapay", icon: Heart, description: "Recurring tips with zero platform fees, ideal for OSS." },
  { name: "Ko-fi", icon: Gift, description: "One-off or monthly tips, no cut on donations." },
  { name: "Open Collective", icon: HandCoins, description: "Transparent, publicly-audited project funding." },
  { name: "GitHub Sponsors", icon: Github, description: "Sponsor development directly from the source repo." },
  { name: "Buy Me a Coffee", icon: Coffee, description: "Casual, low-friction one-off support." },
  { name: "Patreon", icon: Users, description: "Membership tiers for ongoing community support." },
  { name: "Monero (XMR)", icon: Shield, description: "Private, untraceable donations for anonymous backers." },
  { name: "Bitcoin (BTC)", icon: Bitcoin, description: "On-chain donations, no intermediary." },
];

const WHY = [
  {
    icon: Cpu,
    title: "Fund the technology",
    body: "Donations pay for development tools, encryption research, and the physics engine that keeps the mesh honest — every cent goes straight into code you can read.",
  },
  {
    icon: Network,
    title: "Keep the network peer-to-peer",
    body: "There are no servers to rent out from under you. Support keeps signaling relays, torrent trackers, and rendezvous beacons alive so peers can always find each other.",
  },
  {
    icon: Users,
    title: "Community built and operated",
    body: "This project has no company behind it — it is written, moderated, and run by the people who use it. Your contribution keeps that model possible.",
  },
  {
    icon: Server,
    title: "Independent, forever open",
    body: "No ads, no data resale, no investor pressure. Funding from users is the only reason we can stay open source and refuse those trades.",
  },
];

const SupportCard = ({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) => (
  <Card className="rounded-3xl border border-border/40 bg-card/60 p-5 space-y-3">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
    </div>
    <div className="space-y-3">{children}</div>
  </Card>
);

const ExternalButton = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Button asChild variant="outline" className="w-full gap-2">
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink className="h-4 w-4" />
    </a>
  </Button>
);

const Donate = () => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Donate · Support the Imagination Network";
  }, []);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground">Donate</h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              Keep the Imagination Network open, decentralized, and peer-to-peer — powered entirely by the people who use it.
            </p>
          </div>
        </div>

        <Card className="rounded-3xl border border-primary/20 bg-primary/5 p-6 space-y-3">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Mini identity</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
                <Code2 className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">Open source</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The code is public so anyone can inspect, learn, or contribute.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
                <Globe className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">Decentralized</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                No single company owns your data. The mesh spreads control across peers.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
                <Users className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">Peer-to-peer</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                People connect directly, keeping conversations off centralized servers.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">Why donate</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {WHY.map((item) => (
              <Card key={item.title} className="rounded-3xl border border-border/40 bg-card/60 p-5 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">Ways to support</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <SupportCard icon={Gift} title="Lovable gift card">
              <p className="text-sm text-muted-foreground">
                Send a Lovable development gift card to:
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                <span className="text-sm font-mono text-foreground flex-1 truncate">{EMAIL}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopyEmail} aria-label="Copy email address">
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <ExternalButton href={LOVABLE_URL}>Send to Lovable gift card page</ExternalButton>
            </SupportCard>

            <SupportCard icon={Wallet} title="CashApp">
              <p className="text-sm text-muted-foreground">Send support directly through CashApp.</p>
              <Badge variant="secondary">Coming Soon</Badge>
            </SupportCard>

            <SupportCard icon={Coins} title="MintMe">
              <p className="text-sm text-muted-foreground">Use ETH to support development.</p>
              <ExternalButton href={MINTME_URL}>Open MintMe trade page</ExternalButton>
            </SupportCard>

            <SupportCard icon={CreditCard} title="Stripe">
              <p className="text-sm text-muted-foreground">Card-based contributions handled securely.</p>
              <Badge variant="secondary">Coming Soon</Badge>
            </SupportCard>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">Recommended donation platforms</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {RECOMMENDED.map((item) => (
              <Card key={item.name} className="rounded-3xl border border-border/40 bg-card/60 p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground">{item.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                {item.href ? (
                  <ExternalButton href={item.href}>Visit {item.name}</ExternalButton>
                ) : (
                  <Badge variant="secondary">Coming Soon</Badge>
                )}
              </Card>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Project-specific profiles will be published as they open. Every platform above is chosen for low fees and donor privacy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Donate;
