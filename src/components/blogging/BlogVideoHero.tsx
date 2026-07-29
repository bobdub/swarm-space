import { youtubeEmbedUrl } from "@/lib/blogging/youtube";

interface BlogVideoHeroProps {
  videoId: string;
  title?: string;
  className?: string;
}

/**
 * Playable YouTube banner used as a blog hero when the post links a video.
 * No autoplay — the reader presses play.
 */
export function BlogVideoHero({ videoId, title, className }: BlogVideoHeroProps) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden bg-black ${className ?? ""}`}
      data-testid="blog-video-hero"
    >
      <iframe
        src={youtubeEmbedUrl(videoId)}
        title={title ? `${title} — video` : "Blog video"}
        className="absolute inset-0 h-full w-full"
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
