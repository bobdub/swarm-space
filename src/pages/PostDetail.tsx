import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { get } from "@/lib/store";
import type { Post } from "@/types";

const highlightClasses = "ring-2 ring-[hsl(326,71%,62%)] ring-offset-4 ring-offset-[hsla(245,70%,10%,0.85)] transition-shadow";

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!postId) {
      setPost(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    const loadPost = async () => {
      try {
        const storedPost = await get<Post>("posts", postId);
        if (!cancelled) {
          setPost(storedPost ?? null);
        }
      } catch (error) {
        console.error("Failed to load post:", error);
        if (!cancelled) {
          setPost(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPost();

    return () => {
      cancelled = true;
    };
  }, [postId]);

  useEffect(() => {
    if (!post) return;

    const elementId = `post-${post.id}`;
    const element = document.getElementById(elementId);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const highlightClassList = highlightClasses.split(" ");
    element.classList.add(...highlightClassList);

    const timeoutId = window.setTimeout(() => {
      element.classList.remove(...highlightClassList);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
      element.classList.remove(...highlightClassList);
    };
  }, [post]);

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="px-6 py-12">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-display font-bold text-foreground">Post details</h1>
            <p className="text-sm text-foreground/60">
              Permalink for post updates, comments, and sharing.
            </p>
            <Link
              to="/posts"
              className="text-sm text-[hsl(174,59%,56%)] transition-colors hover:text-[hsl(326,71%,62%)]"
            >
              ← Back to posts
            </Link>
          </header>

          {isLoading ? (
            <div className="text-center text-foreground/60">Loading post…</div>
          ) : post ? (
            <PostCard post={post} />
          ) : (
            <div className="space-y-4 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.5)] p-6 text-center text-foreground/70">
              <p className="text-lg font-semibold text-foreground">Post not found</p>
              <p>The post might have been removed or is still syncing.</p>
              <Link
                to="/posts"
                className="text-sm font-medium text-[hsl(174,59%,56%)] transition-colors hover:text-[hsl(326,71%,62%)]"
              >
                Browse all posts
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
