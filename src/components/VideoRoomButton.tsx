import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Video } from 'lucide-react';
import { VideoRoomModal } from './VideoRoomModal';

interface VideoRoomButtonProps {
  projectId?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function VideoRoomButton({ projectId, variant = 'outline', size = 'default', className }: VideoRoomButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setIsModalOpen(true)}
      >
        <Video className="w-4 h-4 mr-2" />
        Start Video Chat
      </Button>

      <VideoRoomModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={projectId}
      />
    </>
  );
}
