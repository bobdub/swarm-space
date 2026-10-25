import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { youtubeEmbedUrl } from "@/lib/blogging/youtube";

interface YouTubeFacadeProps {
  videoId: string;
  title?: string;
}

/**
 * Click-to-play YouTube. Nothing loads until the card nears the screen
 * (thumbnail) and no YouTube scripts run until the reader taps play.
 */
export function YouTubeFacade({ videoId, title }: YouTubeFacadeProps) {
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = title ?? "YouTube video";

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  if (playing) {
    return (
      <iframe
        src={`${youtubeEmbedUrl(videoId)}?autoplay=1&playsinline=1&rel=0`}
        title={label}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        className="absolute inset-0 h-full w-full"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play ${label}`}
      className="group absolute inset-0 h-full w-full"
    >
      <img
        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-110">
          <Play className="ml-1 h-6 w-6" fill="currentColor" />
        </span>
      </span>
    </button>
  );
}
