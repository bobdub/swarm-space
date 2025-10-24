import { Heart, MessageCircle, Share2, MoreHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Post } from "@/types";
import { formatDistanceToNow } from "date-fns";

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });
  
  return (
    <Card className="p-6 shadow-card hover:shadow-glow transition-shadow">
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold">
            {post.authorName?.[0]?.toUpperCase() || "A"}
          </span>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-semibold">{post.authorName || "Anonymous"}</div>
              <div className="text-sm text-muted-foreground">{timeAgo}</div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="mb-4 whitespace-pre-wrap">{post.content}</div>
          
          {post.type === "image" && post.chunks && post.chunks.length > 0 && (
            <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-video flex items-center justify-center">
              <span className="text-muted-foreground">Image (encrypted)</span>
            </div>
          )}
          
          <div className="flex items-center gap-6 text-muted-foreground">
            <Button variant="ghost" size="sm" className="gap-2 hover:text-primary">
              <Heart className="w-4 h-4" />
              <span>{post.likes || 0}</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 hover:text-primary">
              <MessageCircle className="w-4 h-4" />
              <span>{post.comments?.length || 0}</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 hover:text-primary">
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
