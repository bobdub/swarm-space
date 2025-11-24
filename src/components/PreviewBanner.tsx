/**
 * Preview Mode Banner
 * 
 * Displays banner when user is in preview mode with signup CTA
 */

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Eye, X, UserPlus } from 'lucide-react';
import { usePreview } from '@/contexts/PreviewContext';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function PreviewBanner() {
  const { isPreviewMode, previewSession, exitPreview } = usePreview();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!isPreviewMode || user) return null;

  return (
    <Alert className="fixed top-0 left-0 right-0 z-50 rounded-none border-x-0 border-t-0 bg-primary/10 backdrop-blur">
      <Eye className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Preview Mode
          </span>
          <span className="text-xs text-muted-foreground">
            {previewSession?.isProfileFeed
              ? 'Viewing a shared profile'
              : 'Viewing a shared post'}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => navigate('/auth?mode=signup')}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Sign Up to Explore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={exitPreview}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
