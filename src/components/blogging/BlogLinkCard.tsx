import { ExternalLink, Music } from "lucide-react";
import { SwarmLink } from "@/components/routing/SwarmLink";
import { parseSunoLink, prettyUrlLabel } from "@/lib/blogging/links";

interface BlogLinkCardProps {
  href: string;
}

/**
 * Shown for a blog line that is only a link. Full Suno song links get the
 * Suno player; Suno share links and every other link get a tappable card.
 */
export function BlogLinkCard({ href }: BlogLinkCardProps) {
  const suno = parseSunoLink(href);

  if (suno?.kind === "song") {
    return (
      <div className="not-prose space-y-2">
        <div className="overflow-hidden rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-black/40">
          <iframe
            src={suno.embedUrl}
            title="Suno song"
            loading="lazy"
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="h-[240px] w-full"
          />
        </div>
        <SwarmLink
          href={suno.href}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(174,59%,76%)] hover:underline"
        >
          Open on Suno <ExternalLink className="h-3.5 w-3.5" />
        </SwarmLink>
      </div>
    );
  }

  const isSuno = suno !== null;
  const Icon = isSuno ? Music : ExternalLink;

  return (
    <SwarmLink
      href={suno?.href ?? href}
      className="group flex items-center gap-4 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.6)] px-5 py-4 no-underline backdrop-blur transition-colors hover:border-[hsla(174,59%,56%,0.4)] hover:bg-[hsla(245,70%,14%,0.7)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsla(326,71%,62%,0.25)] to-[hsla(174,59%,56%,0.2)]">
        <Icon className="h-5 w-5 text-[hsl(174,59%,76%)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground/90">
          {isSuno ? "Listen on Suno" : "Open link"}
        </span>
        <span className="block truncate text-xs normal-case tracking-normal text-foreground/50">
          {prettyUrlLabel(href)}
        </span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-foreground/40 transition-colors group-hover:text-[hsl(174,59%,76%)]" />
    </SwarmLink>
  );
}

export default BlogLinkCard;
