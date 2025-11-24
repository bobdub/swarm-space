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
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copyToClipboard}>
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              Copy Link
            </>
          )}
        </DropdownMenuItem>
        {navigator.share && (
          <DropdownMenuItem onClick={shareNative}>
            <Share2 className="mr-2 h-4 w-4" />
            Share...
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            const link = generateLink();
            if (link) window.open(link, '_blank');
          }}
        >
          <Link2 className="mr-2 h-4 w-4" />
          Open in New Tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
