/**
 * Preview Page
 * 
 * Sandboxed view for shared posts/profiles in preview mode.
 * Works for both authenticated and unauthenticated users.
 * Acts as an invitation page for new users.
 */

import { useEffect, useState } from 'react';
import { usePreview } from '@/contexts/PreviewContext';
import { useP2PContext } from '@/contexts/P2PContext';
import { useNavigate } from 'react-router-dom';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { PostCard } from '@/components/PostCard';
import { PreviewBanner } from '@/components/PreviewBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserPlus, ArrowLeft, Loader2, Wifi, WifiOff, Gift, Users, Shield, Sparkles } from 'lucide-react';
import { type Post } from '@/types';
import { get } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';

type ConnectionStatus = 'connecting' | 'connected' | 'waiting' | 'offline' | 'failed' | 'unauthenticated';

export default function Preview() {
  const { isPreviewMode, previewSession } = usePreview();
  const { user } = useAuth();
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

    // If user is not authenticated, show invitation UI instead
    if (!user) {
      setConnectionStatus('unauthenticated');
      setLoading(false);
      return;
    }

    // Monitor P2P connection status for authenticated users
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
  }, [isPreviewMode, previewSession, navigate, p2p, user, previewSession?.creatorPeerId]);

  // Load content once connected (only for authenticated users)
  useEffect(() => {
    if (!isPreviewMode || !previewSession || connectionStatus !== 'connected' || !user) {
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
  }, [isPreviewMode, previewSession, connectionStatus, user]);

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

  const handleJoinNetwork = () => {
    // Navigate to auth with current URL preserved for redirect after signup
    navigate('/auth?mode=signup');
  };

  if (!isPreviewMode) return null;

  // Invitation UI for unauthenticated users
  if (connectionStatus === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-primary/5 to-background">
        <PreviewBanner />
        <TopNavigationBar />

        <div className="max-w-2xl mx-auto px-6 py-16 mt-16">
          {/* Invitation Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6">
              <Gift className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
              You've Been Invited!
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              {previewSession?.isProfileFeed 
                ? "Someone wants to share their creative space with you."
                : "Someone shared a post with you from the decentralized network."
              }
            </p>
          </div>

          {/* Benefits Card */}
          <Card className="mb-8 border-primary/20 bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Join the Network
              </CardTitle>
              <CardDescription>
                Create a free account to view this content and explore a decentralized creative community.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded-lg bg-primary/10">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium">Privacy First</h4>
                    <p className="text-sm text-muted-foreground">
                      No servers store your data. Your content lives on your devices.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded-lg bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium">Connect Directly</h4>
                    <p className="text-sm text-muted-foreground">
                      P2P connections mean you connect directly with creators.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded-lg bg-primary/10">
                    <Gift className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium">Earn Rewards</h4>
                    <p className="text-sm text-muted-foreground">
                      Create content, engage with the community, and earn SWARM tokens.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CTA */}
          <div className="text-center space-y-4">
            <Button
              size="lg"
              onClick={handleJoinNetwork}
              className="gap-2 bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_30px_hsla(326,71%,62%,0.5)]"
            >
              <UserPlus className="h-5 w-5" />
              Create Free Account
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Button
                variant="link"
                className="p-0 h-auto text-primary"
                onClick={() => navigate('/auth?tab=recover')}
              >
                Recover it here
              </Button>
            </p>
          </div>

          {/* Preview Info */}
          <div className="mt-12 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-sm text-muted-foreground">
              <Wifi className="h-4 w-4" />
              Content will load after you join
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Connection status UI for authenticated users
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
                  You're viewing shared content from a peer on the network.
                </p>
              </div>
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
          </div>
        ) : previewSession?.isProfileFeed && posts.length > 0 ? (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Recent Posts</h2>
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
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
