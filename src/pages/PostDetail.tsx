import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { get } from "@/lib/store";
import { getBlockedUserIds } from "@/lib/connections";
import { getHiddenPostIds } from "@/lib/hiddenPosts";
import type { Post } from "@/types";

const PostDetail = () => {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPost = useCallback(async () => {
    if (!postId) {
      setPost(null);
      setErrorMessage("We couldn't find that post.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const record = (await get<Post>("posts", postId)) ?? null;

      if (!record) {
        setPost(null);
        setErrorMessage("We couldn't find that post.");
        return;
      }

      if (user) {
        const [blockedIds, hiddenIds] = await Promise.all([
          getBlockedUserIds(user.id),
          getHiddenPostIds(user.id),
        ]);

        if (blockedIds.includes(record.author)) {
          setPost(null);
          setErrorMessage("This post was shared by someone you've blocked.");
          return;
        }

        if (hiddenIds.includes(record.id)) {
          setPost(null);
          setErrorMessage("You've hidden this post from your feeds.");
          return;
        }
      }

      setPost(record);
    } catch (error) {
      console.error("[PostDetail] Failed to load post", error);
      setPost(null);
      setErrorMessage("Something went wrong while loading this post.");
    } finally {
      setIsLoading(false);
    }
  }, [postId, user]);

  useEffect(() => {
    void loadPost();
  }, [loadPost]);

  useEffect(() => {
    const handleSync = () => {
      void loadPost();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, [loadPost]);

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="space-y-4 text-center">
          <h1 className="text-3xl font-display font-bold uppercase tracking-[0.24em] text-foreground md:text-4xl">
            Post Highlight
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-foreground/70 md:text-base">
            Drop into this moment from the network and explore the full conversation.
          </p>
          <div className="flex justify-center">
            <Link to="/posts">
              <Button variant="ghost" className="text-primary">
                ← Back to all posts
              </Button>
            </Link>
          </div>
        </header>

        {isLoading ? (
          <Card className="rounded-3xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
            Loading post…
          </Card>
        ) : errorMessage ? (
          <Card className="rounded-3xl border-[hsla(326,71%,62%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/70 backdrop-blur-xl">
            {errorMessage}
          </Card>
        ) : post ? (
          <PostCard post={post} />
        ) : null}
      </main>
    </div>
  );
};

export default PostDetail;
