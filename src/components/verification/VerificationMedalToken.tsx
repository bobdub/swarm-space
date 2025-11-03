import { formatDistanceToNow } from "date-fns";
import type { CSSProperties } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getMedalMetadata } from "@/lib/verification/medalMetadata";
import type { VerificationMedalRecord } from "@/types/verification";

import { MEDAL_ICON_COMPONENTS } from "./medalIcons";

interface VerificationMedalTokenProps {
  record: VerificationMedalRecord;
  size?: number;
  isActive?: boolean;
  className?: string;
}

export function VerificationMedalToken({
  record,
  size = 32,
  isActive = false,
  className,
}: VerificationMedalTokenProps) {
  const metadata = getMedalMetadata(record.medal);
  const Icon = MEDAL_ICON_COMPONENTS[record.medal];
  const containerStyles: CSSProperties = {
    width: size,
    height: size,
  };
  const iconDimension = Math.max(Math.round(size * 0.55), 12);
  const iconStyles: CSSProperties = {
    width: iconDimension,
    height: iconDimension,
  };
  const earnedDate = new Date(record.earnedAt);
  const earnedLabel = Number.isNaN(earnedDate.getTime())
    ? null
    : formatDistanceToNow(earnedDate, { addSuffix: true });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "relative flex items-center justify-center rounded-xl border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.55)] text-[hsl(326,71%,62%)] shadow-[0_12px_30px_hsla(244,70%,5%,0.45)] transition-all",
            "data-[active=true]:border-[hsl(326,71%,62%)] data-[active=true]:shadow-[0_0_0_3px_rgba(255,255,255,0.08)]",
            className,
          )}
          data-active={isActive}
          style={containerStyles}
        >
          {record.medal === "Last_Reflection" && record.cardImage ? (
            <span className="text-lg" aria-hidden="true">
              {record.cardImage}
            </span>
          ) : Icon ? (
            <Icon style={iconStyles} aria-hidden="true" />
          ) : (
            <span className="text-xs font-semibold" aria-hidden="true">
              {record.medal.slice(0, 1)}
            </span>
          )}
          <span className="sr-only">{metadata.label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-sm">
        <p className="font-semibold text-foreground">{metadata.label}</p>
        {metadata.description ? (
          <p className="text-xs text-foreground/70">{metadata.description}</p>
        ) : null}
        {record.medal === "Last_Reflection" && record.cardImage ? (
          <p className="text-xs text-foreground/60">Repeated card: {record.cardImage}</p>
        ) : null}
        {earnedLabel ? (
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-foreground/50">
            Earned {earnedLabel}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
