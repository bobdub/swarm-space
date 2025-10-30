import type { ReactNode } from "react";

import type { AchievementDisplayItem } from "@/components/achievement-types";
import { cn } from "@/lib/utils";

type AchievementRarity = NonNullable<AchievementDisplayItem["rarity"]>;

interface AchievementSigilProps {
  badge: AchievementDisplayItem;
  size?: number;
  className?: string;
}

const rarityFrameClass: Record<AchievementRarity, string> = {
  common: "border-[hsla(174,59%,56%,0.24)] shadow-[0_0_14px_rgba(124,255,214,0.14)]",
  uncommon: "border-[hsla(165,75%,65%,0.45)] shadow-[0_0_18px_rgba(124,255,214,0.22)]",
  rare: "border-[hsla(202,80%,66%,0.48)] shadow-[0_0_20px_rgba(102,205,255,0.24)]",
  epic: "border-[hsla(285,72%,72%,0.52)] shadow-[0_0_22px_rgba(196,124,255,0.28)]",
  legendary: "border-[hsla(42,96%,62%,0.58)] shadow-[0_0_26px_rgba(255,205,124,0.32)]",
};

function stringToHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hslColor(hueSeed: number, saturation: number, lightness: number): string {
  const hue = ((hueSeed % 360) + 360) % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!meta) return undefined;
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

function getMetaPalette(meta: Record<string, unknown> | undefined): string[] | undefined {
  if (!meta) return undefined;
  const palette = meta.iconPalette;
  if (!Array.isArray(palette)) return undefined;
  const filtered = palette.filter((entry): entry is string => typeof entry === "string");
  return filtered.length ? filtered : undefined;
}

function getCategoryGlyph(
  category: AchievementDisplayItem["category"],
  primary: string,
  accent: string,
  highlight: string,
): ReactNode {
  switch (category) {
    case "content":
      return (
        <g stroke={highlight} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill={primary} fillOpacity="0.22">
          <path d="M36 40L60 34L84 40V84L60 76L36 84Z" />
          <path d="M60 34V76" />
          <path d="M46 46L46 72" />
          <path d="M74 46L74 72" />
        </g>
      );
    case "node":
      return (
        <g stroke={highlight} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="60" cy="40" r="16" fill={primary} fillOpacity="0.28" />
          <circle cx="42" cy="76" r="12" fill={accent} fillOpacity="0.24" />
          <circle cx="78" cy="76" r="12" fill={accent} fillOpacity="0.24" />
          <line x1="60" y1="56" x2="42" y2="64" />
          <line x1="60" y1="56" x2="78" y2="64" />
          <line x1="42" y1="76" x2="78" y2="76" stroke={primary} strokeOpacity="0.85" />
        </g>
      );
    case "social":
      return (
        <g fill={primary} fillOpacity="0.26" stroke={highlight} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <rect x="28" y="38" width="40" height="32" rx="14" />
          <path d="M36 70L32 84L48 70Z" />
          <rect x="60" y="44" width="32" height="26" rx="12" fill={accent} fillOpacity="0.3" />
          <path d="M84 70L88 82L74 68Z" fill={accent} fillOpacity="0.3" />
        </g>
      );
    case "scriptable":
      return (
        <g stroke={highlight} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M46 34C40 34 36 38 36 44V52C36 56 34 58 30 58C34 58 36 60 36 64V72C36 78 40 82 46 82" />
          <path d="M74 34C80 34 84 38 84 44V52C84 56 86 58 90 58C86 58 84 60 84 64V72C84 78 80 82 74 82" />
          <path d="M52 44L68 72" stroke={accent} />
          <path d="M68 44L52 72" stroke={accent} />
        </g>
      );
    default:
      return (
        <g stroke={highlight} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="60" cy="60" r="22" fill={primary} fillOpacity="0.26" />
          <path d="M60 38V26" stroke={accent} />
          <path d="M60 94V82" stroke={accent} />
          <path d="M82 60H94" stroke={accent} />
          <path d="M26 60H38" stroke={accent} />
        </g>
      );
  }
}

export function AchievementSigil({ badge, size = 48, className }: AchievementSigilProps) {
  const iconSeed = getMetaString(badge.meta, "iconSeed") ?? `${badge.id}:${badge.title}`;
  const palette = getMetaPalette(badge.meta);
  const hash = stringToHash(iconSeed);
  const fallbackPalette = [
    hslColor(hash, 72, 58),
    hslColor(hash >> 3, 68, 46),
    hslColor(hash >> 5, 78, 70),
  ];

  const [baseColor, accentColor, highlightColor] = palette && palette.length >= 3
    ? palette.slice(0, 3)
    : fallbackPalette;

  const sanitizedId = iconSeed.replace(/[^a-zA-Z0-9]/g, "");
  const uniqueId = sanitizedId || `sigil${hash}`;
  const gradientId = `achievementGradient${uniqueId}`;
  const glowId = `achievementGlow${uniqueId}`;

  const motifCount = 3 + (hash % 3);
  const motifs = Array.from({ length: motifCount }).map((_, index) => {
    const localSeed = hash >> (index * 4);
    const angle = ((localSeed % 360) * Math.PI) / 180;
    const radius = 18 + (localSeed % 12);
    const cx = 60 + Math.cos(angle) * 18;
    const cy = 60 + Math.sin(angle) * 18;
    const fill = index % 2 === 0 ? accentColor : highlightColor;
    const opacity = 0.18 + ((localSeed % 5) * 0.08);
    return <circle key={index} cx={cx} cy={cy} r={radius / 4 + 6} fill={fill} fillOpacity={Math.min(opacity, 0.6)} />;
  });

  const orbitStroke = `hsla(${((hash >> 2) % 360 + 360) % 360}, 70%, ${badge.unlocked ? 68 : 44}%, 0.45)`;
  const rarityKey: AchievementRarity = badge.rarity ?? "common";
  const frameClass = rarityFrameClass[rarityKey];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-[hsla(245,70%,8%,0.85)] p-[3px] transition-all duration-300",
        badge.unlocked ? frameClass : "border-[hsla(245,70%,24%,0.55)] opacity-70 grayscale",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" className="h-full w-full" role="presentation">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={baseColor} />
            <stop offset="100%" stopColor={accentColor} />
          </linearGradient>
          <radialGradient id={glowId} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={highlightColor} stopOpacity="0.55" />
            <stop offset="80%" stopColor={accentColor} stopOpacity="0.12" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="120" height="120" rx="26" fill={`url(#${gradientId})`} opacity="0.45" />
        <rect width="120" height="120" rx="26" fill={`url(#${glowId})`} opacity="0.7" />

        <g>
          <circle cx="60" cy="60" r="38" fill="none" stroke={orbitStroke} strokeWidth="2.5" strokeDasharray="8 10" />
          {motifs}
        </g>

        {getCategoryGlyph(badge.category, baseColor, accentColor, highlightColor)}
      </svg>
    </div>
  );
}

