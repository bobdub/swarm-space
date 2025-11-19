import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { get } from "@/lib/store";
import type { Post } from "@/types";

const highlightClasses = "ring-2 ring-[hsl(326,71%,62%)] ring-offset-4 ring-offset-[hsla(245,70%,10%,0.85)] transition-shadow";

function shouldHighlightPost(
  hasHighlighted: boolean,
  highlightedPostId: string | null,
  nextPostId: string | null | undefined,
) {
  if (!nextPostId) {
    return false;
  }

  if (!hasHighlighted) {
    return true;
  }

  return highlightedPostId !== nextPostId;
}

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadRequestRef = useRef(0);
  const hasHighlightedRef = useRef(false);
  const highlightedPostIdRef = useRef<string | null>(null);

  useEffect(() => {
    hasHighlightedRef.current = false;
    highlightedPostIdRef.current = null;
  }, [postId]);

  const loadPost = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      const requestId = loadRequestRef.current + 1;
      loadRequestRef.current = requestId;
      const shouldShowLoader = !background;

      if (!postId) {
        setPost(null);
        if (shouldShowLoader || loadRequestRef.current === requestId) {
          setIsLoading(false);
        }
        return;
      }

      if (shouldShowLoader) {
        setIsLoading(true);
      }

      try {
        const storedPost = await get<Post>("posts", postId);
        if (loadRequestRef.current !== requestId) {
          return;
        }
        setPost(storedPost ?? null);
      } catch (error) {
        console.error("Failed to load post:", error);
        if (loadRequestRef.current !== requestId) {
          return;
        }
        setPost(null);
      } finally {
        if (shouldShowLoader || loadRequestRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [postId],
  );

  useEffect(() => {
    void loadPost();
  }, [loadPost]);

  useEffect(() => {
    const handleSync = () => {
      void loadPost({ background: true });
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => {
      window.removeEventListener("p2p-posts-updated", handleSync);
    };
  }, [loadPost]);

  useEffect(() => {
    if (!post) return;

    const shouldHighlight = shouldHighlightPost(
      hasHighlightedRef.current,
      highlightedPostIdRef.current,
      post.id,
    );
    if (!shouldHighlight) {
      return;
    }

    const elementId = `post-${post.id}`;
    const element = document.getElementById(elementId);
    if (!element) return;

    hasHighlightedRef.current = true;
    highlightedPostIdRef.current = post.id;

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
