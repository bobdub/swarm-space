import { Heart, MessageCircle, Share2, MoreHorizontal } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Post } from "@/types";

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });
  const initials = post.authorName?.[0]?.toUpperCase() || "A";

  return (
    <div className="group relative overflow-hidden rounded-[26px]">
      <div className="absolute inset-0 rounded-[26px] bg-gradient-to-br from-[hsla(326,71%,62%,0.28)] via-transparent to-[hsla(174,59%,56%,0.28)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute inset-0 rounded-[26px] bg-[hsla(326,71%,62%,0.18)] opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-60" />
      <Card className="relative rounded-[26px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-6 text-foreground shadow-[0_30px_90px_hsla(244,70%,5%,0.65)] backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex gap-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-[hsla(326,71%,62%,0.45)] bg-[hsla(253,82%,6%,0.85)] text-base font-display uppercase tracking-[0.22em] text-[hsl(326,71%,62%)] shadow-[0_18px_40px_hsla(326,71%,62%,0.38)]">
            {initials}
          </div>

          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-lg font-semibold tracking-[0.08em] text-foreground">
                  {post.authorName || "Anonymous"}
                </div>
                <div className="text-[0.65rem] font-display uppercase tracking-[0.35em] text-foreground/55">
                  {timeAgo}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full border border-[hsla(174,59%,56%,0.2)] text-foreground/60 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.65)] hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-5">
              <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/75">
                {post.content}
              </div>

              {post.type === "image" && post.manifestIds && post.manifestIds.length > 0 && (
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] text-sm text-foreground/60 backdrop-blur">
                  Image (encrypted)
                </div>
              )}

              {post.type === "video" && post.manifestIds && post.manifestIds.length > 0 && (
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] text-sm text-foreground/60 backdrop-blur">
                  Video (encrypted)
                </div>
              )}

              {post.type === "file" && post.manifestIds && post.manifestIds.length > 0 && (
                <div className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-5 py-4 text-sm text-foreground/70 backdrop-blur">
                  {post.manifestIds.length} file(s) attached
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-foreground/60">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
              >
                <Heart className="h-4 w-4" />
                <span>{post.likes || 0}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
              >
                <MessageCircle className="h-4 w-4" />
                <span>{post.comments?.length || 0}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
