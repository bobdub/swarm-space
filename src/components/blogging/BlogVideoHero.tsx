import { YouTubeFacade } from "./YouTubeFacade";

interface BlogVideoHeroProps {
  videoId: string;
  title?: string;
  className?: string;
}

/** YouTube banner for blog heroes; loads only after the reader taps play. */
export function BlogVideoHero({ videoId, title, className }: BlogVideoHeroProps) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden bg-black ${className ?? ""}`}
      data-testid="blog-video-hero"
    >
      <YouTubeFacade videoId={videoId} title={title ? `${title} — video` : "Blog video"} />
    </div>
  );
}
