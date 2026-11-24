/**
 * Link awareness for blog titles and bodies: split text into text/URL
 * pieces, spot lines that are only a link, and recognise Suno songs so the
 * blog page can show a player or a link card instead of a dead string.
 */

const URL_SOURCE = String.raw`(?:https?:\/\/|www\.)[^\s<>"]+`;

/** Punctuation that usually ends a sentence rather than the link. */
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/;

export type LinkPiece =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; href: string };

export const normalizeUrl = (rawUrl: string): string =>
  /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

/** Break a string into plain text and URL pieces, in order. */
export function splitLinks(text: string): LinkPiece[] {
  const pieces: LinkPiece[] = [];
  const pattern = new RegExp(URL_SOURCE, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    let raw = match[0];
    // Keep a closing bracket when the link itself opened one, e.g. wiki URLs.
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    if (trailing) {
      let keep = 0;
      if (trailing.startsWith(")") && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) {
        keep = 1;
      }
      raw = raw.slice(0, raw.length - trailing.length + keep);
    }
    if (!raw) continue;

    if (match.index > lastIndex) {
      pieces.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    pieces.push({ kind: "url", text: raw, href: normalizeUrl(raw) });
    lastIndex = match.index + raw.length;
    pattern.lastIndex = lastIndex;
  }

  if (lastIndex < text.length) {
    pieces.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return pieces;
}

export function containsUrl(text: string): boolean {
  return new RegExp(URL_SOURCE, "i").test(text);
}

/** When a line holds nothing but one link, return that link's href. */
export function urlOnlyLine(line: string): string | null {
  const pieces = splitLinks(line.trim());
  if (pieces.length !== 1 || pieces[0].kind !== "url") return null;
  return pieces[0].href;
}

/** A short, readable label for a link: host and path, original case. */
export function prettyUrlLabel(href: string): string {
  try {
    const url = new URL(normalizeUrl(href));
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/+$/, "");
    const label = `${host}${path}`;
    return label.length > 60 ? `${label.slice(0, 57)}…` : label;
  } catch {
    return href;
  }
}

export type SunoLink =
  | { kind: "song"; href: string; songId: string; embedUrl: string }
  | { kind: "share"; href: string };

const SUNO_SONG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recognise suno.com links. Full song links (/song/<uuid>) can be embedded;
 * short share links (/s/<code>) only resolve on Suno's side, so they get a
 * link card instead.
 */
export function parseSunoLink(href: string): SunoLink | null {
  let url: URL;
  try {
    url = new URL(normalizeUrl(href));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "suno.com" && !host.endsWith(".suno.com") && host !== "suno.ai" && !host.endsWith(".suno.ai")) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if ((segments[0] === "song" || segments[0] === "embed") && segments[1] && SUNO_SONG_ID.test(segments[1])) {
    const songId = segments[1];
    return { kind: "song", href: url.toString(), songId, embedUrl: `https://suno.com/embed/${songId}` };
  }
  return { kind: "share", href: url.toString() };
}
