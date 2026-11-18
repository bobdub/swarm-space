/**
 * Personal Archive format — offline-readable Markdown that also round-trips.
 *
 *   README.md                          export summary + identity
 *   posts/YYYY-MM-DD_<post-id>.md      YAML frontmatter, body, attachments, conversation
 *   media/<file-id>-<name>             decrypted attachments
 *
 * Frontmatter values are written as JSON (a subset of YAML), so any YAML
 * reader can open them and our importer can parse them without a YAML
 * dependency. Comments carry an HTML-comment marker with their ids so the
 * thread structure survives import while rendering cleanly in any viewer.
 */

import type { Comment, Post } from "@/types";

export const ARCHIVE_FORMAT = "swarm-personal-archive";
export const ARCHIVE_VERSION = 1;
const ATTACHMENTS_MARKER = "<!-- swarm:attachments -->";
const CONVERSATION_MARKER = "<!-- swarm:conversation -->";

export interface ArchiveMediaRef {
  /** Path relative to the archive root, e.g. `media/file-1-cat.png`. */
  path: string;
  /** The manifest id the post referenced when exported. */
  manifestId: string;
  name: string;
  mime: string;
  size?: number;
}

export function safeName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[_.]+|_+$/g, "");
  return cleaned || fallback;
}

export function mediaPath(manifestId: string, originalName: string): string {
  return `media/${safeName(manifestId, "file")}-${safeName(originalName, "attachment")}`;
}

export function postPath(post: Pick<Post, "id" | "createdAt">): string {
  const day = Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString().slice(0, 10) : "undated";
  return `posts/${day}_${safeName(post.id, "post")}.md`;
}

export function postTitle(post: Pick<Post, "content">): string {
  const firstLine = (post.content ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  if (!firstLine) return "Untitled post";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

// ── Frontmatter (JSON-valued YAML) ─────────────────────────────────────

type FrontValue = string | number | boolean | null | Array<string | Record<string, unknown>>;

export function emitFrontmatter(fields: Record<string, FrontValue | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) { lines.push(`${key}: []`); continue; }
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseFrontmatter(markdown: string): { fields: Record<string, unknown>; body: string } {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fields: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: text };
  const header = text.slice(4, end).split("\n");
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const fields: Record<string, unknown> = {};
  let listKey: string | null = null;
  const parseValue = (raw: string): unknown => {
    const v = raw.trim();
    if (v === "") return null;
    try { return JSON.parse(v); } catch { return v.replace(/^['"]|['"]$/g, ""); }
  };
  for (const line of header) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (fields[listKey] as unknown[]).push(parseValue(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2].trim() === "") {
      listKey = kv[1];
      fields[listKey] = [];
    } else {
      listKey = null;
      fields[kv[1]] = parseValue(kv[2]);
    }
  }
  return { fields, body };
}

// ── Posts ──────────────────────────────────────────────────────────────

function mediaMarkdown(ref: ArchiveMediaRef): string {
  const href = `../${ref.path.split("/").map(encodeURIComponent).join("/")}`;
  if (ref.mime.startsWith("image/")) return `![Attachment: ${ref.name}](${href})`;
  if (ref.mime.startsWith("video/")) return `[Video: ${ref.name}](${href})`;
  return `[Attachment: ${ref.name}](${href})`;
}

function orderComments(comments: Comment[]): Array<{ comment: Comment; depth: number }> {
  const byParent = new Map<string, Comment[]>();
  const ids = new Set(comments.map((c) => c.id));
  for (const c of comments) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : "";
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(c);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: Array<{ comment: Comment; depth: number }> = [];
  const walk = (parent: string, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ comment: c, depth });
      walk(c.id, Math.min(depth + 1, 6));
    }
  };
  walk("", 0);
  return out;
}

export function renderPostMarkdown(post: Post, media: ArchiveMediaRef[], comments: Comment[]): string {
  const coinId = (post as Post & { _coinId?: string })._coinId;
  const front = emitFrontmatter({
    format: ARCHIVE_FORMAT,
    title: postTitle(post),
    post_id: post.id,
    author: post.author,
    author_name: post.authorName ?? null,
    created_at: post.createdAt,
    edited_at: post.editedAt,
    type: post.type,
    tags: post.tags ?? [],
    coin_id: coinId ?? null,
    project_id: post.projectId ?? undefined,
    nsfw: post.nsfw ? true : undefined,
    blog_classification: post.blogClassification,
    media: media.map((m) => ({ ...m })),
    comment_count: comments.length,
  });

  const parts = [front, "", post.content ?? ""];
  if (media.length > 0) parts.push("", ATTACHMENTS_MARKER, "", ...media.map(mediaMarkdown));
  if (comments.length > 0) {
    parts.push("", CONVERSATION_MARKER, "", "## Conversation", "");
    for (const { comment, depth } of orderComments(comments)) {
      const quote = "> ".repeat(depth);
      const marker = JSON.stringify({ id: comment.id, parent: comment.parentId ?? null, author: comment.author, created: comment.createdAt });
      parts.push(`<!-- swarm:comment ${marker} -->`);
      parts.push(`${quote}**${comment.authorName || comment.author}** · ${comment.createdAt}`);
      parts.push(...comment.text.split("\n").map((line) => `${quote}${line}`));
      parts.push("");
    }
  }
  return parts.join("\n").trimEnd() + "\n";
}

export interface ParsedArchivePost {
  post: Omit<Post, "manifestIds"> & { _coinId?: string };
  media: ArchiveMediaRef[];
  comments: Comment[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function parsePostMarkdown(markdown: string): ParsedArchivePost | null {
  const { fields, body } = parseFrontmatter(markdown);
  const id = str(fields.post_id);
  const author = str(fields.author);
  const createdAt = str(fields.created_at);
  if (fields.format !== ARCHIVE_FORMAT || !id || !author || !createdAt) return null;

  const cut = [ATTACHMENTS_MARKER, CONVERSATION_MARKER].map((m) => body.indexOf(m)).filter((i) => i >= 0);
  const content = (cut.length ? body.slice(0, Math.min(...cut)) : body).replace(/\n+$/, "");

  const type = (["text", "image", "video", "file", "stream"] as const).find((t) => t === fields.type) ?? "text";
  const post: ParsedArchivePost["post"] = {
    id,
    author,
    type,
    content,
    createdAt,
    ...(str(fields.author_name) ? { authorName: str(fields.author_name) } : {}),
    ...(str(fields.edited_at) ? { editedAt: str(fields.edited_at) } : {}),
    ...(Array.isArray(fields.tags) ? { tags: fields.tags.filter((t): t is string => typeof t === "string") } : {}),
    ...(str(fields.project_id) ? { projectId: str(fields.project_id) } : {}),
    ...(fields.nsfw === true ? { nsfw: true } : {}),
    ...(str(fields.blog_classification) ? { blogClassification: fields.blog_classification as Post["blogClassification"] } : {}),
    ...(str(fields.coin_id) ? { _coinId: str(fields.coin_id) } : {}),
  };

  const media: ArchiveMediaRef[] = Array.isArray(fields.media)
    ? fields.media.flatMap((m) => {
        const r = m as Record<string, unknown>;
        const path = str(r?.path);
        const manifestId = str(r?.manifestId);
        if (!path || !manifestId || !path.startsWith("media/") || path.includes("..")) return [];
        return [{ path, manifestId, name: str(r.name) ?? path.slice(6), mime: str(r.mime) ?? "application/octet-stream", ...(typeof r.size === "number" ? { size: r.size } : {}) }];
      })
    : [];

  const comments: Comment[] = [];
  const convoAt = body.indexOf(CONVERSATION_MARKER);
  if (convoAt >= 0) {
    const blocks = body.slice(convoAt).split(/<!-- swarm:comment (\{.*?\}) -->\n/);
    for (let i = 1; i < blocks.length; i += 2) {
      let meta: Record<string, unknown>;
      try { meta = JSON.parse(blocks[i]); } catch { continue; }
      const cid = str(meta.id);
      const cAuthor = str(meta.author);
      const created = str(meta.created);
      if (!cid || !cAuthor || !created) continue;
      const lines = blocks[i + 1].replace(/\n+$/, "").split("\n");
      const header = lines.shift() ?? "";
      const depthPrefix = /^((?:> )*)/.exec(header)?.[1] ?? "";
      const name = /\*\*(.*?)\*\*/.exec(header)?.[1];
      const text = lines.map((l) => (l.startsWith(depthPrefix) ? l.slice(depthPrefix.length) : l)).join("\n");
      comments.push({
        id: cid,
        postId: id,
        author: cAuthor,
        ...(name && name !== cAuthor ? { authorName: name } : {}),
        text,
        createdAt: created,
        ...(str(meta.parent) ? { parentId: str(meta.parent) } : {}),
      });
    }
  }
  return { post, media, comments };
}

// ── README ─────────────────────────────────────────────────────────────

export function renderArchiveReadme(input: {
  generatedAt: string;
  username?: string;
  displayName?: string;
  userId?: string;
  posts: number;
  comments: number;
  media: number;
  warnings: string[];
}): string {
  const front = emitFrontmatter({
    format: ARCHIVE_FORMAT,
    archive_version: ARCHIVE_VERSION,
    exported_at: input.generatedAt,
    username: input.username ?? null,
    user_id: input.userId ?? null,
    posts: input.posts,
    comments: input.comments,
    media: input.media,
  });
  return [
    front,
    "",
    `# Swarm Space personal archive${input.displayName || input.username ? `: ${input.displayName || input.username}` : ""}`,
    "",
    `Exported ${input.generatedAt}.`,
    "",
    `- **Posts:** ${input.posts}`,
    `- **Comments:** ${input.comments}`,
    `- **Media files:** ${input.media}`,
    "",
    "Each post lives in `posts/` as a Markdown file you can read in any editor. Attachments are decrypted into `media/`",
    "and linked from their posts. Import this .zip in Settings → Storage → Personal archive to restore it on any device.",
    ...(input.warnings.length ? ["", "## Warnings", "", ...input.warnings.map((w) => `- ${w}`)] : []),
    "",
  ].join("\n");
}
