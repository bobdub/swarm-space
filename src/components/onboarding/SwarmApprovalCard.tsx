/**
 * SwarmApprovalCard — A synthetic "post" in the feed that asks the visitor
 * to accept the mesh connection before any content streams in.
 *
 * Held entirely in-memory — no localStorage writes.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wifi, ShieldCheck, Zap, Globe } from "lucide-react";

interface SwarmApprovalCardProps {
  onAccept: () => void;
}

export function SwarmApprovalCard({ onAccept }: SwarmApprovalCardProps) {
  const [accepting, setAccepting] = useState(false);

  const handleAccept = () => {
    setAccepting(true);
    // Brief delay for visual feedback
    setTimeout(() => onAccept(), 400);
  };

  return (
    <Card className="relative overflow-hidden border-[hsla(174,59%,56%,0.28)] bg-[hsla(245,70%,8%,0.85)] backdrop-blur-md">
      {/* Subtle animated accent bar */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[hsl(174,59%,56%)] via-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]" />

      <div className="p-5 space-y-4">
        {/* Header — looks like a post author row */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsla(174,59%,56%,0.15)] ring-1 ring-[hsla(174,59%,56%,0.3)]">
            <Globe className="h-5 w-5 text-[hsl(174,59%,56%)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">SWARM Network</span>
              <Badge variant="outline" className="border-[hsla(174,59%,56%,0.3)] text-[hsl(174,59%,56%)] text-[0.6rem] px-1.5 py-0">
                System
              </Badge>
            </div>
            <span className="text-xs text-foreground/50">just now</span>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-foreground/80">
            A decentralized mesh network has been discovered. Connect to browse posts and content
            from peers across the network.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Wifi, label: "Peer-to-peer", detail: "No servers" },
              { icon: ShieldCheck, label: "Encrypted", detail: "End-to-end" },
              { icon: Zap, label: "Real-time", detail: "Live sync" },
            ].map(({ icon: Icon, label, detail }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1 rounded-lg border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,12%,0.5)] px-2 py-2.5 text-center"
              >
                <Icon className="h-4 w-4 text-[hsl(174,59%,56%)]" />
                <span className="text-[0.65rem] font-medium text-foreground/80">{label}</span>
                <span className="text-[0.55rem] text-foreground/40">{detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action — single click to connect */}
        <Button
          onClick={handleAccept}
          disabled={accepting}
          className="w-full gap-2 bg-gradient-to-r from-[hsl(174,59%,56%)] to-[hsl(174,59%,76%)] text-[hsl(245,70%,8%)] font-semibold hover:shadow-[0_0_24px_hsla(174,59%,56%,0.35)] active:scale-[0.97] transition-all"
        >
          {accepting ? (
            <>
              <Wifi className="h-4 w-4 animate-pulse" />
              Connecting…
            </>
          ) : (
            <>
              <Wifi className="h-4 w-4" />
              Connect to Network
            </>
          )}
        </Button>

        <p className="text-center text-[0.6rem] text-foreground/35">
          Read-only access. Create an account to interact.
        </p>
      </div>
    </Card>
  );
}
