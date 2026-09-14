import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Megaphone,
  Sparkles,
  Pencil,
  Mic,
  Film,
  Tv,
  CalendarDays,
  Mail,
} from "lucide-react";

const FEATURES = [
  {
    icon: Pencil,
    title: "Custom Script Writing",
    body: "We'll write the advertisement for you. Just share some basic information about your project, token, or goals and we'll craft a script that fits the DWMW tone.",
  },
  {
    icon: Mic,
    title: "Professional Voice Acting",
    body: "We'll perform the script for you, or if you'd rather be the voice of your own project, we'll provide a rebound bounty for your recorded performance.",
  },
  {
    icon: Film,
    title: "Custom Animation",
    body: "We'll animate your advertisement and give you a downloadable copy you can reuse in your own promotions and personal creations.",
  },
  {
    icon: Tv,
    title: "Featured on DWMW",
    body: "Your finished advertisement is edited into the DWMW 24/7 live stream as an ad break, or included as a sponsored segment inside an actual episode of DWMW.",
  },
];

const Adverts = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Advertise Your Token • DWMW";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-3">
            <h1 className="text-3xl md:text-5xl font-bold text-foreground">
              Advertise Your Token on DWMW
            </h1>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              Put your project in front of our audience with a customized advertising segment inside the DWMW 24/7 Live Stream or a promotional spot featured directly within an episode of DWMW.
            </p>
          </div>
        </div>

        <Card className="rounded-3xl border border-primary/20 bg-primary/5 p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Megaphone className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Bring Your Project to Life</h2>
          </div>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            A fun, creative advertisement helps people discover what you're building. Let DWMW help spread the word across the live stream and show episodes.
          </p>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Here's what we do for you</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="rounded-3xl border border-border/40 bg-card/60 p-6 space-y-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <feature.icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-foreground leading-tight">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.body}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <Card className="rounded-3xl border border-border/40 bg-card/60 p-6 md:p-8 space-y-6">
          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-primary mt-0.5" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">One Month Run</h2>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                Each advert campaign runs for one month. Your spot will rotate through the live stream and may also be placed inside an episode segment.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Note: the live stream may be down from time to time while a new playlist is being built or maintenance is in progress.
              </p>
            </div>
          </div>

          <Button asChild className="w-full sm:w-auto gap-2 rounded-full bg-gradient-to-r from-primary to-secondary px-6 py-3 text-sm font-semibold uppercase tracking-[0.1em] shadow-[0_10px_40px_hsla(var(--primary),0.35)] transition-transform hover:scale-[1.02]">
            <a href="mailto:dwminuteworld@gmail.com?subject=Promote%20My%20Token%20on%20DWMW">
              <Mail className="h-4 w-4" />
              Get in Touch
            </a>
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default Adverts;
