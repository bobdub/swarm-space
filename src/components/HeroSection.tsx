import { Button } from "./ui/button";
import { ArrowRight, Shield, Zap, Network } from "lucide-react";
import { Link } from "react-router-dom";

export function HeroSection() {
  return (
    <div className="relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent animate-pulse" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,hsla(326,71%,62%,0.15),transparent_50%)]" />
      
      {/* Content */}
      <div className="relative px-6 py-16 md:py-24 text-center max-w-4xl mx-auto">
        {/* Title */}
        <div className="mb-8 animate-fade-in">
          <h1 className="mx-auto inline-block text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-4 bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent animate-shimmer [text-shadow:none]">
            Imagination Network
          </h1>
          <div className="h-1 w-32 mx-auto bg-gradient-to-r from-primary to-secondary rounded-full shadow-[0_0_20px_hsla(326,71%,62%,0.5)]" />
        </div>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-foreground/80 mb-4 max-w-2xl mx-auto leading-relaxed animate-fade-in">
          A decentralized, offline-first collaboration platform where your data belongs to you.
        </p>
        <p className="text-sm md:text-base text-foreground/60 mb-12 max-w-xl mx-auto animate-fade-in">
          Create, collaborate, and share—without trusting a server. Everything is encrypted, 
          locally stored, and shared peer-to-peer.
        </p>

        {/* Feature Pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-12 animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Zero-Knowledge</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-secondary/30 bg-secondary/10 backdrop-blur-sm">
            <Zap className="h-4 w-4 text-secondary" />
            <span className="text-sm font-medium">Offline-First</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-accent/30 bg-accent/10 backdrop-blur-sm">
            <Network className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium">P2P Network</span>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-in">
          <Link to="/create">
            <Button 
              size="lg" 
              className="group bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_30px_hsla(326,71%,62%,0.5)] transition-all duration-300"
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          <Link to="/explore">
            <Button 
              size="lg" 
              variant="outline"
              className="border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all duration-300"
            >
              Explore Projects
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-2xl mx-auto animate-fade-in">
          <div className="text-center">
            <div className="text-3xl font-bold text-primary mb-2">100%</div>
            <div className="text-sm text-foreground/60 uppercase tracking-wide">Encrypted</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-secondary mb-2">0</div>
            <div className="text-sm text-foreground/60 uppercase tracking-wide">Servers Needed</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-accent mb-2">∞</div>
            <div className="text-sm text-foreground/60 uppercase tracking-wide">Possibilities</div>
          </div>
        </div>
      </div>
    </div>
  );
}
