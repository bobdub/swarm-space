import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { get } from "@/lib/store";
import {
  classifyPost,
  extractBlogTitle,
} from "@/lib/blogging/awareness";
import {
  decryptAndReassembleFile,
  importKeyRaw,
  type Manifest,
} from "@/lib/fileEncryption";
import { useP2PContext } from "@/contexts/P2PContext";
import type { Post } from "@/types";

export default function BlogDetail() {
  const { postId } = useParams<{ postId: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { ensureManifest } = useP2PContext();

  const loadPost = useCallback(async () => {
    if (!postId) {
      setPost(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const storedPost = await get<Post>("posts", postId);
      setPost(storedPost ?? null);
    } catch (error) {
      console.error("Failed to load blog post:", error);
      setPost(null);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void loadPost();
  }, [loadPost]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadHero = async () => {
      setHeroUrl(null);
      if (!post?.manifestIds?.length) return;

      for (const manifestId of post.manifestIds) {
        let manifest = await get<Manifest>("manifests", manifestId);

        if (!manifest || !manifest.fileKey || !manifest.chunks?.length) {
          const ensured = await ensureManifest(manifestId);
          if (ensured) {
            manifest = ensured as Manifest;
          }
        }

        if (!manifest?.fileKey) continue;
        if (!(manifest.mime || "").startsWith("image/")) continue;

        try {
          const fileKey = await importKeyRaw(manifest.fileKey);
          const blob = await decryptAndReassembleFile(manifest, fileKey);
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setHeroUrl(objectUrl);
          }
          return;
        } catch (error) {
          console.warn(`[BlogDetail] Failed to decrypt hero manifest ${manifestId}:`, error);
        }
      }
    };

    void loadHero();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [ensureManifest, post?.id, post?.manifestIds]);

  const classification = useMemo(() => (post ? classifyPost(post).classification : "post"), [post]);
  const isBlogPost = classification === "blog" || classification === "book";

  const title = useMemo(() => {
    if (!post) return "";
    return extractBlogTitle(post.content);
  }, [post]);

  const contentBody = useMemo(() => {
    if (!post) return "";
    const lines = post.content.split("\n");
    const firstLineIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstLineIndex <= -1) return post.content;
    return lines.filter((_, idx) => idx !== firstLineIndex).join("\n").trim() || post.content;
  }, [post]);

  const readMinutes = useMemo(() => {
    if (!post) return 0;
    const words = (post.content ?? "").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }, [post]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNavigationBar />

      <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10 md:px-8">
        <Link to="/posts" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Back to posts
        </Link>

        {isLoading ? (
          <div className="text-center text-muted-foreground">Loading blog…</div>
        ) : !post ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            Blog not found.
          </div>
        ) : !isBlogPost ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">This post is not classified as a blog.</p>
            <PostCard post={post} />
          </div>
        ) : (
          <article className="space-y-8">
            {heroUrl ? (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <img
                  src={heroUrl}
                  alt={`${title} hero image`}
                  className="h-auto max-h-[460px] w-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : null}

            <header className="space-y-4">
              <h1 className="text-3xl font-display font-bold tracking-tight md:text-5xl">{title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <Avatar
                  avatarRef={post.authorAvatarRef}
                  username={post.authorName || post.author}
                  size="sm"
                  className="h-7 w-7"
                />
                <span>{post.authorName || post.author}</span>
                <span>•</span>
                <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
                <span>•</span>
                <span>{readMinutes} min read</span>
                {classification === "book" ? (
                  <>
                    <span>•</span>
                    <span className="font-medium text-primary">Book</span>
                  </>
                ) : null}
              </div>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5 md:p-8">
              <p className="whitespace-pre-wrap text-base leading-8 text-foreground/90 md:text-lg">
                {contentBody}
              </p>
            </section>

            {classification === "book" ? (
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                This long-form post is flagged as a book and should be served via torrent wrapping for full distribution.
              </div>
            ) : null}
          </article>
        )}
      </main>
    </div>
  );
}
