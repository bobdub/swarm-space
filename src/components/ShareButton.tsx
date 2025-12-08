/**
 * Share Button Component
 * 
 * Generates and copies share links for posts and profiles
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Share2, Link2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { generatePostShareLink, generateProfileShareLink } from '@/lib/preview/previewMode';
import { useP2P } from '@/hooks/useP2P';

interface ShareButtonProps {
  type: 'post' | 'profile';
  postId?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showLabel?: boolean;
}

export function ShareButton({
  type,
  postId,
  variant = 'ghost',
  size = 'sm',
  showLabel = false,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const p2p = useP2P();
  const peerId = p2p.getPeerId();

  const generateLink = () => {
    if (!peerId) {
      toast.error('P2P not connected');
      return null;
    }

    if (type === 'post' && postId) {
      return generatePostShareLink(postId, peerId);
    } else if (type === 'profile') {
      return generateProfileShareLink(peerId);
    }
    return null;
  };

  const copyToClipboard = async () => {
    const link = generateLink();
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Share link copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const shareNative = async () => {
    const link = generateLink();
    if (!link) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: type === 'post' ? 'Check out this post' : 'Check out my profile',
          url: link,
        });
      } catch (error) {
        // User cancelled share
      }
    } else {
      copyToClipboard();
    }
  };

  if (!peerId) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          <Share2 className="h-4 w-4" />
          {showLabel && 'Share'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={copyToClipboard} className="flex flex-col items-start gap-1">
          <div className="flex items-center w-full">
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-green-500" />
                <span className="font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                <span className="font-medium">Copy Share Link</span>
              </>
            )}
          </div>
          <span className="text-xs text-muted-foreground ml-6">
            Share with anyone - no account needed to view
          </span>
        </DropdownMenuItem>
        {navigator.share && (
          <DropdownMenuItem onClick={shareNative}>
            <Share2 className="mr-2 h-4 w-4" />
            Share via...
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            const link = generateLink();
            if (link) window.open(link, '_blank');
          }}
          className="flex flex-col items-start gap-1"
        >
          <div className="flex items-center w-full">
            <Link2 className="mr-2 h-4 w-4" />
            <span>Preview Link</span>
          </div>
          <span className="text-xs text-muted-foreground ml-6">
            Test how others will see this
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
