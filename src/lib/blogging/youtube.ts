/**
 * Shared YouTube link awareness for posts and blogs.
 * Extracted verbatim from PostCard so every surface resolves IDs identically.
 */

const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

const normalizeUrl = (rawUrl: string): string =>
  rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

export const extractYoutubeVideoIds = (content: string): string[] => {
  const pattern = new RegExp(URL_REGEX);
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content ?? "")) !== null) {
    const href = normalizeUrl(match[0]);

    try {
      const url = new URL(href);
      const hostname = url.hostname.toLowerCase();

      if (hostname === "youtu.be") {
        const pathId = url.pathname.split("/").filter(Boolean)[0];
        if (pathId) {
          ids.add(pathId);
        }
        continue;
      }

      if (!hostname.endsWith("youtube.com")) {
        continue;
      }

      const segments = url.pathname.split("/").filter(Boolean);

      if (segments.length === 0 || segments[0] === "watch") {
        const id = url.searchParams.get("v");
        if (id) {
          ids.add(id);
        }
        continue;
      }

      const [firstSegment, secondSegment] = segments;
      if (
        firstSegment === "embed" ||
        firstSegment === "shorts" ||
        firstSegment === "live" ||
        firstSegment === "v"
      ) {
        const id = secondSegment ?? segments[segments.length - 1];
        if (id) {
          ids.add(id);
        }
      }
    } catch {
      // Ignore malformed URLs when attempting to build embeds
    }
  }

  return Array.from(ids);
};

export const firstYoutubeVideoId = (content: string): string | null =>
  extractYoutubeVideoIds(content ?? "")[0] ?? null;

export const youtubeEmbedUrl = (videoId: string): string =>
  `https://www.youtube.com/embed/${videoId}`;
