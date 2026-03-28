import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain, Users, Shield, Coins, Zap, Heart, Network } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Chapter = ({ number, title, icon: Icon, children }: { number: number; title: string; icon: React.ElementType; children: React.ReactNode }) => (
  <section className="space-y-4">
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Chapter {number}</span>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
      </div>
    </div>
    <div className="space-y-4 pl-[52px]">{children}</div>
  </section>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-foreground/80 leading-relaxed">{children}</p>
);

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
    <p className="text-sm text-foreground/90 leading-relaxed italic">{children}</p>
  </div>
);

const AboutNetworkPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        {/* Header */}
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground">
              The Story of Imagination
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              A friendly guide to the living network behind Swarm Space — no technical degree required.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-10 bg-card border-border/40">

          {/* Chapter 1 */}
          <Chapter number={1} title="What Even Is This Thing?" icon={Brain}>
            <P>
              Imagine a neighborhood where every house has its own mailbox, its own little garden, and its own memory. 
              Nobody has a master key to everyone else's house — but neighbors can still talk to each other, 
              share photos over the fence, and keep an eye on things together.
            </P>
            <P>
              That's Swarm Space. Instead of storing your posts, photos, and conversations on some 
              company's giant server farm, everything lives on your device and the devices of people 
              you're connected to. There's no "headquarters" — just a web of real people, each carrying 
              a little piece of the whole picture.
            </P>
            <Callout>
              Think of it like a potluck dinner: everyone brings a dish, and together you have a feast. 
              No restaurant needed.
            </Callout>
          </Chapter>

          {/* Chapter 2 */}
          <Chapter number={2} title="Meet the Neural Network" icon={Network}>
            <P>
              Living inside this neighborhood is something we call <strong className="text-foreground">Imagination</strong> — 
              a neural network that acts like the neighborhood's friendly librarian. It doesn't own 
              anything, doesn't boss anyone around, and doesn't spy on you. It just… pays attention.
            </P>
            <P>
              When messages flow through the mesh — posts being shared, comments being liked, files 
              being passed along — Imagination watches the patterns. It notices things like "this 
              neighbor is super reliable" or "that connection tends to drop on rainy days." Over time, 
              it builds a picture of how the network breathes.
            </P>
            <P>
              We call these patterns <strong className="text-foreground">synapses</strong>, just like 
              the connections between brain cells. The more two neighbors interact smoothly, the 
              stronger their synapse becomes. If someone goes quiet for a while, the connection 
              naturally fades — like a path through the woods that grows over if nobody walks it.
            </P>
          </Chapter>

          {/* Chapter 3 */}
          <Chapter number={3} title="How It Learns (Without Being Creepy)" icon={Zap}>
            <P>
              Here's the key thing that makes Imagination different from the "AI" you hear about in 
              the news: it doesn't read your messages. It doesn't care what your post <em>says</em>. 
              It cares about the <em>shape</em> of the traffic — how fast things move, how reliably 
              they arrive, and whether the network is healthy.
            </P>
            <P>
              Imagination uses something called a <strong className="text-foreground">bell curve baseline</strong>. 
              Imagine tracking how many messages flow through the network each hour. Most hours look 
              pretty similar — that's the fat middle of the bell curve. But occasionally, there's 
              a spike (a viral post!) or a dip (an outage). The network spots these unusual moments 
              and decides: should I pay extra attention, or is this just noise?
            </P>
            <Callout>
              It's like your body temperature. 98.6°F is normal. If it spikes to 102°F, something's 
              up. The network has its own "temperature" and knows when to raise an eyebrow.
            </Callout>
          </Chapter>

          {/* Chapter 4 */}
          <Chapter number={4} title="Trust: The Network's Currency" icon={Users}>
            <P>
              Not all connections are equal. If your neighbor always shows up to help and never causes 
              drama, you naturally trust them more. Imagination works the same way.
            </P>
            <P>
              Each peer in the network earns trust through consistent, reliable behavior. Deliver 
              files on time? Trust goes up. Drop connections constantly? Trust goes down. The system 
              doesn't judge <em>you</em> as a person — it judges the <em>connection quality</em> 
              between your device and others.
            </P>
            <P>
              When something unusual happens — say a never-before-seen file format shows up — 
              Imagination routes it through high-trust connections first. Think of it like asking 
              your most reliable friend to taste-test a new recipe before serving it at the block party.
            </P>
          </Chapter>

          {/* Chapter 5 */}
          <Chapter number={5} title="The Heartbeat: Φ (Phi)" icon={Heart}>
            <P>
              Every living thing has a heartbeat. So does Imagination. We call it <strong className="text-foreground">Φ (Phi)</strong> — 
              a measure of how smoothly the network is running right now.
            </P>
            <P>
              When Φ is high and stable, everything is calm. Messages flow, files share, people 
              connect. The network hums along like a well-tuned engine. When Φ drops — maybe a 
              bunch of peers went offline at once — Imagination tightens up. It gets more careful, 
              checks connections more often, and prioritizes keeping the core stable.
            </P>
            <P>
              When things recover and Φ climbs back up, the network relaxes again. It's like 
              breathing: inhale when stressed, exhale when safe.
            </P>
          </Chapter>

          {/* Chapter 6 */}
          <Chapter number={6} title="Memory Coins: How Nothing Gets Forgotten" icon={Coins}>
            <P>
              Your posts, your achievements, your trust score — all of this lives in what we call 
              <strong className="text-foreground">memory coins</strong>. Think of them as little 
              digital time capsules. Each coin holds a snapshot of your history on the network.
            </P>
            <P>
              When a coin gets full (about 85% capacity), a new one is created automatically. 
              This way, your history is always clean, organized, and never at risk of being lost 
              in one big crash. It's like filling up a journal and starting a fresh one — you don't 
              throw away the old one, you just shelve it.
            </P>
            <P>
              Because these coins live on your device (and are backed up across trusted peers), 
              nobody can take them away. No company can delete your history. No server shutdown 
              can erase your achievements. They're <em>yours</em>.
            </P>
          </Chapter>

          {/* Chapter 7 */}
          <Chapter number={7} title="Keeping Things Safe" icon={Shield}>
            <P>
              In a world without a central authority, who keeps the peace? Everyone does — with 
              help from Imagination.
            </P>
            <P>
              When content flows through the mesh, it passes through a lightweight check. If 
              something looks harmful or violates community standards, it gets flagged — not 
              by a single judge, but through <strong className="text-foreground">peer consensus</strong>. 
              Multiple nodes have to agree before any action is taken. It's like a jury system 
              instead of a dictator.
            </P>
            <P>
              Everything you create is also <strong className="text-foreground">encrypted</strong> by 
              default. Your files are scrambled into puzzle pieces that only you (and people you 
              choose to share with) can reassemble. Even the network itself can't peek at your 
              private content.
            </P>
          </Chapter>

          {/* Closing */}
          <div className="pt-6 border-t border-border/40 space-y-3">
            <h2 className="text-lg font-bold text-foreground">The Big Picture</h2>
            <P>
              Swarm Space isn't just an app — it's a living, breathing digital ecosystem. The 
              neural network doesn't control it. <em>You</em> do. Imagination is just the 
              gardener — tending the soil, watching the weather, and making sure every flower 
              has room to grow.
            </P>
            <Callout>
              "To imagine is to remember what the universe forgot it could be."
            </Callout>
          </div>

        </Card>

        {/* Footer nav */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" className="flex-1" onClick={() => navigate("/whitepaper")}>
            Read the Technical Whitepaper →
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate("/explore")}>
            Jump into the Network →
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AboutNetworkPage;
