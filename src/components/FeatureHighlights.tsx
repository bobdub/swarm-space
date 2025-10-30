import { Shield, Wifi, Lock, Zap, Users, Folder } from "lucide-react";
import { Card } from "./ui/card";

const features = [
  {
    icon: Shield,
    title: "Zero-Knowledge Security",
    description: "Your data is encrypted locally. No server ever sees your unencrypted content.",
    gradient: "from-primary/20 to-primary/5"
  },
  {
    icon: Wifi,
    title: "Offline-First",
    description: "Full functionality without internet. Network sync is additive, not required.",
    gradient: "from-secondary/20 to-secondary/5"
  },
  {
    icon: Lock,
    title: "End-to-End Encrypted",
    description: "AES-GCM encryption for files, ECDH for identity. Military-grade security.",
    gradient: "from-accent/20 to-accent/5"
  },
  {
    icon: Zap,
    title: "Content-Addressed Storage",
    description: "Files are chunked and addressed by hash. Automatic deduplication and integrity checks.",
    gradient: "from-primary/20 to-secondary/5"
  },
  {
    icon: Users,
    title: "P2P Collaboration",
    description: "Connect directly with peers. Share content device-to-device without intermediaries.",
    gradient: "from-secondary/20 to-accent/5"
  },
  {
    icon: Folder,
    title: "Project Management",
    description: "Organize work with projects, tasks, milestones. Kanban boards and calendar views.",
    gradient: "from-accent/20 to-primary/5"
  }
];

export function FeatureHighlights() {
  return (
    <div className="px-6 py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12 animate-fade-in">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-4 text-foreground">
            Built for Privacy & Control
          </h2>
          <p className="text-foreground/60 max-w-2xl mx-auto">
            A new kind of platform that puts you in control of your data, 
            your privacy, and your creative work.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card
              key={feature.title}
              className={`group relative overflow-hidden border-primary/20 bg-gradient-to-br ${feature.gradient} backdrop-blur-sm p-6 hover:border-primary/40 hover:shadow-[0_0_30px_hsla(326,71%,62%,0.2)] transition-all duration-300 animate-fade-in`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Icon */}
              <div className="mb-4 p-3 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20 w-fit group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>

              {/* Content */}
              <h3 className="text-lg font-semibold mb-2 text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm text-foreground/70 leading-relaxed">
                {feature.description}
              </p>

              {/* Hover Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
