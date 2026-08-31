import type { BlogHeroMedia } from "@/lib/blogging/heroMedia";

interface BlogMediaHeroProps {
  hero: BlogHeroMedia;
  title?: string;
  className?: string;
  /** Feed cards keep the frame muted and compact; detail pages show controls. */
  compact?: boolean;
}

/**
 * Uploaded banner media (image or short video clip) for a blog post.
 * Videos never autoplay — the reader presses play.
 */
export function BlogMediaHero({ hero, title, className, compact }: BlogMediaHeroProps) {
  if (hero.kind === "video") {
    return (
      <video
        src={hero.url}
        controls
        playsInline
        muted={compact}
        preload="metadata"
        aria-label={title ? `${title} — banner video` : "Blog banner video"}
        className={className ?? "h-full w-full bg-black object-contain"}
      />
    );
  }

  return (
    <img
      src={hero.url}
      alt={title ? `${title} hero image` : "Blog hero"}
      loading="lazy"
      className={className ?? "h-full w-full object-cover"}
    />
  );
}

export default BlogMediaHero;
