import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, BookOpen, Clock, Lock, User } from "lucide-react";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { CommentThread } from "@/components/CommentThread";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { get } from "@/lib/store";
import {
  classifyPost,
  extractBlogTitle,
} from "@/lib/blogging/awareness";
import { canViewWalledPost } from "@/lib/blockchain/walledPost";
import { WalledPostUnlockModal } from "@/components/WalledPostUnlockModal";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import type { Post } from "@/types";
import blogQuillIcon from "@/assets/blog-quill-icon.png";
import { loadBlogHeroImage } from "@/lib/blogging/heroMedia";

export default function BlogDetail() {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [pendingManifestIds, setPendingManifestIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
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

  useEffect(() => { void loadPost(); }, [loadPost]);

  const loadHero = useCallback(async () => {
    if (!post?.manifestIds?.length) {
      setPendingManifestIds([]);
      setHeroUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const { heroUrl: nextHeroUrl, pendingManifestIds: pending } = await loadBlogHeroImage(
      post.manifestIds,
      ensureManifest,
    );

    setPendingManifestIds(pending);
    setHeroUrl((prev) => {
      if (prev && prev !== nextHeroUrl) {
        URL.revokeObjectURL(prev);
      }
      return nextHeroUrl;
    });
  }, [ensureManifest, post?.manifestIds]);

  useEffect(() => {
    void loadHero();
  }, [loadHero, post?.id]);

  useEffect(() => {
    if (pendingManifestIds.length === 0) return;

    const retryTimeout = window.setTimeout(() => {
      void loadHero();
    }, 2500);

    return () => {
      window.clearTimeout(retryTimeout);
    };
  }, [pendingManifestIds, loadHero]);

  useEffect(() => {
    if (pendingManifestIds.length === 0) return;

    const handlePostsUpdated = async () => {
      await loadHero();
    };

    window.addEventListener("p2p-posts-updated", handlePostsUpdated);
    return () => {
      window.removeEventListener("p2p-posts-updated", handlePostsUpdated);
    };
  }, [pendingManifestIds.length, loadHero]);

  useEffect(() => {
    return () => {
      if (heroUrl) {
        URL.revokeObjectURL(heroUrl);
      }
    };
  }, [heroUrl]);

  const classification = useMemo(() => (post ? classifyPost(post).classification : "post"), [post]);
  const isBlogPost = classification === "blog" || classification === "book";
  const isBook = classification === "book";

  // Walled post awareness
  const isWalled = post?.walled === true && !post?.walledCommunityUnlocked;
  const canView = post ? canViewWalledPost(post, user?.id) : true;
  const isWalledHidden = isWalled && !canView;

  const title = useMemo(() => (post ? extractBlogTitle(post.content) : ""), [post]);

  const contentBody = useMemo(() => {
    if (!post || isWalledHidden) return "";
    const lines = post.content.split("\n");
    const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
    if (firstNonEmpty <= -1) return post.content;
    return lines.filter((_, idx) => idx !== firstNonEmpty).join("\n").trim() || post.content;
  }, [post, isWalledHidden]);

  const paragraphs = useMemo(() => {
    return contentBody
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [contentBody]);

  const readMinutes = useMemo(() => {
    if (!post) return 0;
    const words = (post.content ?? "").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }, [post]);

  const timeAgo = post ? formatDistanceToNow(new Date(post.createdAt), { addSuffix: true }) : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNavigationBar />

      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-60 -top-40 h-[36rem] w-[36rem] rounded-full bg-[hsla(326,71%,62%,0.08)] blur-[200px]" />
        <div className="absolute -right-40 top-1/4 h-[30rem] w-[30rem] rounded-full bg-[hsla(174,59%,56%,0.06)] blur-[220px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-[hsla(245,70%,30%,0.06)] blur-[180px]" />
      </div>

      {isLoading ? (
        <main className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <img src={blogQuillIcon} alt="" className="h-12 w-12 animate-pulse opacity-40" />
            <p className="text-sm font-display uppercase tracking-[0.3em] text-foreground/40">Loading blog…</p>
          </div>
        </main>
      ) : !post ? (
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="space-y-4 rounded-2xl border border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,8%,0.7)] p-12 backdrop-blur-xl">
            <BookOpen className="mx-auto h-10 w-10 text-foreground/30" />
            <p className="font-display text-lg uppercase tracking-[0.2em] text-foreground/60">Blog not found</p>
            <Link to="/posts" className="text-sm text-primary hover:underline">← Back to posts</Link>
          </div>
        </main>
      ) : !isBlogPost ? (
        <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
          <p className="text-sm text-foreground/50">This post is not classified as a blog.</p>
          <PostCard post={post} />
        </main>
      ) : (
        <>
          {/* ── Hero Section ── */}
          {heroUrl ? (
            <div className="relative mx-auto max-w-5xl px-4 pt-6 md:px-8">
              <div className="overflow-hidden rounded-3xl border border-[hsla(174,59%,56%,0.12)] shadow-[0_40px_120px_hsla(326,71%,62%,0.12)]">
                <div className="relative">
                  <img
                    src={heroUrl}
                    alt={`${title} hero image`}
                    className="h-auto max-h-[520px] w-full object-cover"
                    loading="lazy"
                  />
                  {/* Cinematic gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-background/20 via-transparent to-background/20" />
                </div>
              </div>
            </div>
          ) : (
            /* Abstract quill hero when no media */
            <div className="relative mx-auto max-w-5xl px-4 pt-6 md:px-8">
              <div className="flex h-48 items-center justify-center overflow-hidden rounded-3xl border border-[hsla(174,59%,56%,0.1)] bg-gradient-to-br from-[hsla(326,71%,62%,0.08)] via-[hsla(245,70%,10%,0.5)] to-[hsla(174,59%,56%,0.06)]">
                <img
                  src={blogQuillIcon}
                  alt=""
                  className="h-20 w-20 object-contain opacity-25 drop-shadow-[0_0_40px_hsla(326,71%,62%,0.5)]"
                />
              </div>
            </div>
          )}

          {/* ── Article Content ── */}
          <article className="relative mx-auto max-w-3xl space-y-10 px-6 pb-24 pt-10 md:px-10">
            {/* Back link */}
            <Link
              to="/posts"
              className="group inline-flex items-center gap-2 text-xs font-display uppercase tracking-[0.3em] text-foreground/40 transition-colors hover:text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
              All Posts
            </Link>

            {/* Title */}
            <header className="space-y-6">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className="rounded-lg border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)] text-[hsl(174,59%,76%)] text-[10px] uppercase tracking-[0.25em]"
                >
                  {isBook ? "Book" : "Blog"}
                </Badge>
              </div>

              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl">
                {title}
              </h1>

              {/* Decorative rule */}
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-[hsla(326,71%,62%,0.4)] to-transparent" />
                <img src={blogQuillIcon} alt="" className="h-5 w-5 opacity-30" />
                <div className="h-px flex-1 bg-gradient-to-l from-[hsla(174,59%,56%,0.4)] to-transparent" />
              </div>

              {/* Author meta */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-foreground/50">
                <div className="flex items-center gap-2">
                  <Avatar
                    avatarRef={post.authorAvatarRef}
                    username={post.authorName || post.author}
                    size="sm"
                    className="h-8 w-8"
                  />
                  <span className="font-display uppercase tracking-[0.15em] text-foreground/70">
                    {post.authorName || post.author}
                  </span>
                </div>
                <span className="text-foreground/20">|</span>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{readMinutes} min read</span>
                </div>
                <span className="text-foreground/20">|</span>
                <span>{timeAgo}</span>
              </div>
            </header>

            {/* ── Body: gated by walled state ── */}
            {isWalledHidden ? (
              <section className="space-y-6">
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-[hsla(326,71%,62%,0.2)] bg-[hsla(245,70%,12%,0.45)] px-8 py-12 text-center backdrop-blur">
                  <Lock className="h-12 w-12 text-[hsl(326,71%,62%)]" />
                  <p className="text-lg font-semibold text-foreground/80">Encrypted {isBook ? "Book" : "Blog"}</p>
                  <p className="max-w-md text-sm text-foreground/50">
                    This content is locked behind an encrypted paywall.
                    Unlock for {post.unlockCostAmount ?? "?"}{" "}
                    <span className="text-[hsl(174,59%,66%)]">${post.unlockCostTicker ?? "TOKEN"}</span>{" "}
                    to read the full {isBook ? "book" : "blog"}.
                  </p>
                  {user && (
                    <Button
                      onClick={() => setIsUnlockModalOpen(true)}
                      className="mt-2 gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
                    >
                      <Lock className="h-4 w-4" /> Unlock Content
                    </Button>
                  )}
                  {!user && (
                    <p className="text-xs text-foreground/40">Sign in to unlock this content.</p>
                  )}
                </div>
              </section>
            ) : (
              <>
                <section className="space-y-8">
                  {paragraphs.map((paragraph, index) => {
                    const isFirstParagraph = index === 0;
                    const lines = paragraph.split("\n");

                    return (
                      <div key={index}>
                        {lines.map((line, lineIdx) => {
                          const isDropCapLine = isFirstParagraph && lineIdx === 0 && line.length > 20;

                          if (isDropCapLine) {
                            const firstChar = line[0];
                            const rest = line.slice(1);
                            return (
                              <p
                                key={lineIdx}
                                className="text-lg leading-[2] tracking-wide text-foreground/85 md:text-xl"
                              >
                                <span className="float-left mr-3 mt-1 font-display text-6xl font-bold leading-[0.8] text-primary md:text-7xl">
                                  {firstChar}
                                </span>
                                {rest}
                              </p>
                            );
                          }

                          return (
                            <p
                              key={lineIdx}
                              className="text-lg leading-[2] tracking-wide text-foreground/85 md:text-xl"
                            >
                              {line}
                            </p>
                          );
                        })}
                      </div>
                    );
                  })}
                </section>

                {/* Book notice */}
                {isBook && (
                  <div className="rounded-2xl border border-[hsla(326,71%,62%,0.2)] bg-[hsla(326,71%,62%,0.04)] px-6 py-5 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-primary">Torrent-Wrapped Book</p>
                        <p className="text-xs leading-relaxed text-foreground/50">
                          This long-form work exceeds 250,000 characters and is served via SWARM torrent wrapping for efficient decentralized distribution.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Comments */}
                <div className="rounded-2xl border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,8%,0.6)] p-5 backdrop-blur-xl md:p-8">
                  <CommentThread postId={post.id} />
                </div>
              </>
            )}

            {/* End flourish */}
            <div className="flex items-center justify-center gap-4 pt-6">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-[hsla(326,71%,62%,0.3)]" />
              <div className="h-2 w-2 rotate-45 border border-[hsla(174,59%,56%,0.3)] bg-[hsla(174,59%,56%,0.1)]" />
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[hsla(174,59%,56%,0.3)]" />
            </div>

            {/* Author card at bottom */}
            <Link
              to={`/u/${post.author}`}
              className="group block rounded-2xl border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,8%,0.6)] p-6 backdrop-blur-xl transition-all hover:border-[hsla(174,59%,56%,0.25)] hover:shadow-[0_20px_60px_hsla(326,71%,62%,0.08)]"
            >
              <div className="flex items-center gap-4">
                <Avatar
                  avatarRef={post.authorAvatarRef}
                  username={post.authorName || post.author}
                  size="lg"
                  className="h-14 w-14"
                />
                <div className="space-y-1">
                  <p className="font-display text-sm uppercase tracking-[0.2em] text-foreground/80 transition-colors group-hover:text-primary">
                    {post.authorName || post.author}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-foreground/40">
                    <User className="h-3 w-3" />
                    View all posts & blogs
                  </p>
                </div>
              </div>
            </Link>
          </article>

          {/* Unlock modal */}
          {post && user && (
            <WalledPostUnlockModal
              open={isUnlockModalOpen}
              onOpenChange={setIsUnlockModalOpen}
              post={post}
              userId={user.id}
            />
          )}
        </>
      )}
    </div>
  );
}