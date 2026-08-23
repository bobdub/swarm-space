import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ExternalLink,
  Rocket,
  Users,
  Clapperboard,
  Building2,
  Wrench,
  Mic,
  Heart,
} from "lucide-react";

const TOKEN_CARDS = [
  {
    symbol: "Quantum Gathering",
    icon: Users,
    title: "Fuel the Swarm Space",
    body: "Support the core function of Swarm Space by helping build and strengthen the liquidity of its community coin. Your contribution helps provide a stronger foundation for the ecosystem surrounding Quantum Gathering, supporting the continued development and activity of the community.",
    href: "https://www.mintme.com/token/Quantum-Gathering/MINTME/trade",
    cta: "Trade Quantum Gathering",
  },
  {
    symbol: "DWMW",
    icon: Clapperboard,
    title: "Support the Show. Support the Community.",
    body: "Help support DWMW, the community's main web show and production. Your contribution helps keep the show moving—from production and development to new episodes, creative projects, and community entertainment. Keep the cameras rolling. Keep the stories moving. Keep DWMW alive.",
    href: "https://www.mintme.com/token/DWMW/MINTME/trade",
    cta: "Trade DWMW",
  },
  {
    symbol: "MTCG",
    icon: Building2,
    title: "Build the Foundation",
    body: "Support the founding community behind the network and help provide resources for the people building, creating, promoting, and expanding what comes next. Your contribution helps strengthen the foundation that allows builders and promoters to turn ideas into active community projects. Build something. Promote something. Help the community grow.",
    href: "https://www.mintme.com/token/MTCG/ETH/trade",
    cta: "Trade MTCG",
  },
  {
    symbol: "bobdubbloon",
    icon: Wrench,
    title: "Behind the Scenes",
    body: "Support the work that happens behind the curtain. Donations help with production, editing, management, and the countless details required to turn raw ideas into finished creative projects. From the first concept to the final cut, your support helps transform community creations into something people can actually experience.",
    href: "https://www.mintme.com/token/bobdubbloon/MINTME/trade",
    cta: "Trade bobdubbloon",
  },
  {
    symbol: "Ottoken",
    icon: Mic,
    title: "Give the Community a Voice",
    body: "Support voice acting, podcasting, and creator presence. Your contribution helps bring characters to life, conversations into the world, and voices into the community, supporting the people who give personality and presence to its creative projects. Because sometimes an idea doesn't just need to be seen—it needs a voice.",
    href: "https://www.mintme.com/token/Ottoken",
    cta: "Trade Ottoken",
  },
];

const TokenCard = ({
  icon: Icon,
  title,
  body,
  symbol,
  href,
  cta,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  symbol: string;
  href: string;
  cta: string;
}) => (
  <Card className="rounded-3xl border border-border/40 bg-card/60 p-6 space-y-4 flex flex-col">
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-base font-bold text-foreground leading-tight">{title}</h3>
        <p className="text-xs text-muted-foreground">{symbol}</p>
      </div>
    </div>
    <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
    <Button asChild variant="outline" className="w-full gap-2">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {cta}
        <ExternalLink className="h-4 w-4" />
      </a>
    </Button>
  </Card>
);

const Donate = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Donate • Support the Community • Fuel Creation";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-3">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">
              Donate • Support the Community • Fuel Creation
            </h1>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              Every great community is powered by the people who build it, create within it, and keep it alive.
            </p>
          </div>
        </div>

        <Card className="rounded-3xl border border-primary/20 bg-primary/5 p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Help Keep the Community Moving</h2>
          </div>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            Your support helps creators stay active, inspired, and connected, while providing the resources needed to continue producing shows, developing projects, building communities, performing, editing, experimenting, and bringing new ideas into existence.
          </p>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            Whether you want to support a specific creator or contribute to one of the community's larger projects, every donation helps keep the creative network growing.
          </p>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">Choose what to support</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {TOKEN_CARDS.map((card) => (
              <TokenCard key={card.symbol} {...card} />
            ))}
          </div>
        </div>

        <Card className="rounded-3xl border border-primary/20 bg-primary/5 p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Heart className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Every Contribution Helps</h2>
          </div>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            You don't have to support everything. Choose the creator, project, or community function you want to help grow. Every contribution—large or small—can help provide the momentum needed to keep people creating, building, performing, producing, and sharing.
          </p>
          <p className="text-base md:text-lg font-semibold text-foreground">
            Support creativity. Fuel community. Keep the network moving.
          </p>
        </Card>
      </div>
    </div>
  );
};

export default Donate;
