/**
 * Preview Page
 * 
 * Sandboxed view for shared posts/profiles in preview mode
 */

import { useEffect, useState } from 'react';
import { usePreview } from '@/contexts/PreviewContext';
import { useP2PContext } from '@/contexts/P2PContext';
import { useNavigate } from 'react-router-dom';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { PostCard } from '@/components/PostCard';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Button } from '@/components/ui/button';
import { UserPlus, ArrowLeft, Loader2, Wifi, WifiOff } from 'lucide-react';
import { type Post } from '@/types';
import { get } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';

type ConnectionStatus = 'connecting' | 'connected' | 'waiting' | 'offline' | 'failed';

export default function Preview() {
  const { isPreviewMode, previewSession } = usePreview();
  const p2p = useP2PContext();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isPreviewMode) {
      navigate('/');
      return;
    }

    if (!previewSession) {
      setLoading(false);
      setConnectionStatus('failed');
      return;
    }

    // Monitor P2P connection status
    const checkConnection = () => {
      const activePeers = p2p.getActivePeerConnections();
      const isConnected = activePeers.some(peer => peer.peerId === previewSession.creatorPeerId);
      
      if (isConnected) {
        setConnectionStatus('connected');
      } else if (p2p.isConnecting) {
        setConnectionStatus('connecting');
      } else if (p2p.isEnabled && !isConnected) {
        setConnectionStatus('waiting');
      } else if (!p2p.isEnabled) {
        setConnectionStatus('offline');
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 1000);

    return () => clearInterval(interval);
  }, [isPreviewMode, previewSession, navigate, p2p, previewSession?.creatorPeerId]);

  // Load content once connected
  useEffect(() => {
    if (!isPreviewMode || !previewSession || connectionStatus !== 'connected') {
      return;
    }

    const loadPreviewContent = async () => {
      setLoading(true);

      // Wait a moment for P2P sync to complete
      await new Promise(resolve => setTimeout(resolve, 1500));

      if (previewSession.postId) {
        // Try to load post from local store (synced via P2P)
        const postData = await get<Post>('posts', previewSession.postId);
        if (postData) {
          setPost(postData);
        } else {
          console.warn('[Preview] Post not found after P2P sync:', previewSession.postId);
        }
      } else {
        // Load profile feed
        const { getAll } = await import('@/lib/store');
        const allPosts = await getAll<Post>('posts');
        // Filter by creator's user ID if available
        setPosts(allPosts.slice(0, 10));
      }

      setLoading(false);
    };

    loadPreviewContent();
  }, [isPreviewMode, previewSession, connectionStatus]);

  // Retry connection
  const handleRetry = () => {
    if (!previewSession) return;
    
    setRetryCount(prev => prev + 1);
    setConnectionStatus('connecting');
    setLoading(true);
    
    p2p.connectToPeer(previewSession.creatorPeerId, {
      manual: true,
      source: 'preview-mode',
    });
  };

  if (!isPreviewMode) return null;

  // Connection status UI
  const renderConnectionStatus = () => {
    if (connectionStatus === 'connecting') {
      return (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Connecting to creator's node...
          </AlertDescription>
        </Alert>
      );
    }

    if (connectionStatus === 'waiting') {
      return (
        <Alert>
          <Wifi className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Waiting for creator's node to come online...</span>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (connectionStatus === 'offline') {
      return (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>P2P network is offline. Cannot load preview.</span>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (connectionStatus === 'failed') {
      return (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Failed to connect to creator's node.</span>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  };

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

          {/* Connection Status */}
          {renderConnectionStatus()}
        </div>

        {/* Preview Content */}
        {connectionStatus !== 'connected' ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              {connectionStatus === 'connecting' && 'Establishing connection...'}
              {connectionStatus === 'waiting' && 'Waiting for creator to come online...'}
              {connectionStatus === 'offline' && 'P2P network is offline'}
              {connectionStatus === 'failed' && 'Failed to establish connection'}
            </p>
            {(connectionStatus === 'waiting' || connectionStatus === 'failed') && (
              <Button onClick={handleRetry} variant="outline">
                Try Again
              </Button>
            )}
          </div>
        ) : loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading preview content...</p>
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
