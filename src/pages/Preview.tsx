/**
 * Preview Page
 * 
 * Sandboxed view for shared posts/profiles in preview mode
 */

import { useEffect, useState } from 'react';
import { usePreview } from '@/contexts/PreviewContext';
import { useNavigate } from 'react-router-dom';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { PostCard } from '@/components/PostCard';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Button } from '@/components/ui/button';
import { UserPlus, ArrowLeft } from 'lucide-react';
import { type Post } from '@/types';
import { get } from '@/lib/store';

export default function Preview() {
  const { isPreviewMode, previewSession } = usePreview();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isPreviewMode) {
      navigate('/');
      return;
    }

    const loadPreviewContent = async () => {
      setLoading(true);

      if (previewSession?.postId) {
        // Load single post
        const postData = await get<Post>('posts', previewSession.postId);
        if (postData) {
          setPost(postData);
        }
      } else {
        // Load profile feed (would need to sync from creator peer)
        // This is simplified - in reality would request from P2P peer
        const { getAll } = await import('@/lib/store');
        const allPosts = await getAll<Post>('posts');
        // Filter by creator's posts (would match by peer/user connection)
        setPosts(allPosts.slice(0, 10));
      }

      setLoading(false);
    };

    loadPreviewContent();
  }, [isPreviewMode, previewSession, navigate]);

  if (!isPreviewMode) return null;

  return (
    <div className="min-h-screen pb-20">
      <PreviewBanner />
      <TopNavigationBar />

      <div className="max-w-4xl mx-auto px-6 py-8 mt-16">
        {/* Preview Header */}
        <div className="mb-8 space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Button>

          <div className="bg-card rounded-lg border p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold mb-2">
                  {previewSession?.isProfileFeed ? 'Profile Preview' : 'Post Preview'}
                </h1>
                <p className="text-muted-foreground">
                  You're viewing shared content. Sign up to explore more and connect with the network.
                </p>
              </div>
              <Button
                variant="default"
                onClick={() => navigate('/auth?mode=signup')}
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" />
                Sign Up
              </Button>
            </div>

            <div className="flex gap-2 text-sm text-muted-foreground">
              <span className="px-2 py-1 bg-primary/10 rounded-md">
                🔒 Sandboxed Preview
              </span>
              <span className="px-2 py-1 bg-secondary/10 rounded-md">
                📡 Temporary Connection
              </span>
            </div>
          </div>
        </div>

        {/* Preview Content */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading preview...
          </div>
        ) : previewSession?.postId && post ? (
          <div className="space-y-6">
            <PostCard post={post} />
            
            <div className="text-center py-8 border-t">
              <p className="text-muted-foreground mb-4">
                Want to see more? Create an account to explore the full network.
              </p>
              <Button
                size="lg"
                onClick={() => navigate('/auth?mode=signup')}
                className="gap-2"
              >
                <UserPlus className="h-5 w-5" />
                Create Account
              </Button>
            </div>
          </div>
        ) : previewSession?.isProfileFeed && posts.length > 0 ? (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Recent Posts</h2>
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
            
            <div className="text-center py-8 border-t">
              <p className="text-muted-foreground mb-4">
                This is just a preview. Sign up to follow and see all posts.
              </p>
              <Button
                size="lg"
                onClick={() => navigate('/auth?mode=signup')}
                className="gap-2"
              >
                <UserPlus className="h-5 w-5" />
                Create Account
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Content not available
          </div>
        )}
      </div>
    </div>
  );
}
