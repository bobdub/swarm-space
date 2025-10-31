import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Video, VideoOff, Mic, MicOff, Users, Radio } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { toast } from 'sonner';

interface VideoRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function VideoRoomModal({ isOpen, onClose, projectId }: VideoRoomModalProps) {
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  const {
    currentRoom,
    localStream,
    isAudioEnabled,
    isVideoEnabled,
    participants,
    createRoom,
    leaveRoom,
    startLocalStream,
    stopLocalStream,
    toggleAudio,
    toggleVideo,
    startStreaming,
    stopStreaming,
    mutePeer,
    banPeer,
  } = useWebRTC();

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      toast.error('Please enter a room name');
      return;
    }

    setIsCreating(true);
    try {
      const room = await createRoom({
        name: roomName,
        projectId,
        isPrivate,
      });

      if (room) {
        toast.success('Room created successfully');
        await startLocalStream(true, true);
      }
    } catch (error) {
      console.error('Failed to create room:', error);
      toast.error('Failed to create room');
    } finally {
      setIsCreating(false);
    }
  };

  const handleLeaveRoom = async () => {
    await leaveRoom();
    stopLocalStream();
    onClose();
    toast.success('Left the room');
  };

  const handleStartStreaming = async () => {
    const post = await startStreaming(projectId);
    if (post) {
      toast.success('Started streaming to feed');
    } else {
      toast.error('Failed to start streaming');
    }
  };

  const handleStopStreaming = async () => {
    await stopStreaming();
    toast.success('Stopped streaming');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {currentRoom ? `Room: ${currentRoom.name}` : 'Create Video Room'}
          </DialogTitle>
          <DialogDescription>
            {currentRoom 
              ? 'Manage your video chat room' 
              : 'Start an audio/video chat with others'}
          </DialogDescription>
        </DialogHeader>

        {!currentRoom ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="roomName">Room Name</Label>
              <Input
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Enter room name"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isPrivate"
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
              />
              <Label htmlFor="isPrivate">Invite Only</Label>
            </div>

            <Button 
              onClick={handleCreateRoom} 
              disabled={isCreating}
              className="w-full"
            >
              <Video className="w-4 h-4 mr-2" />
              Create Room
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Video Grid */}
            <div className="grid grid-cols-2 gap-4">
              {/* Local Video */}
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                {localStream ? (
                  <video
                    ref={(video) => {
                      if (video && localStream) {
                        video.srcObject = localStream;
                        video.play();
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <VideoOff className="w-12 h-12 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-sm">
                  You
                </div>
              </div>

              {/* Remote Videos */}
              {participants.map((participant) => (
                <div key={participant.peerId} className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                  {participant.stream ? (
                    <video
                      ref={(video) => {
                        if (video && participant.stream) {
                          video.srcObject = participant.stream;
                          video.play();
                        }
                      }}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <VideoOff className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-sm">
                    {participant.username}
                    {participant.isMuted && <MicOff className="w-3 h-3 inline ml-1" />}
                  </div>
                  
                  {/* Host Controls */}
                  {currentRoom.hostId === currentRoom.participants[0] && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => mutePeer(participant.peerId)}
                      >
                        <MicOff className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => banPeer(participant.peerId)}
                      >
                        Ban
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Room Info */}
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <Users className="w-5 h-5" />
              <span className="text-sm">
                {participants.length + 1} participant(s)
              </span>
              {currentRoom.isPrivate && (
                <span className="text-sm text-muted-foreground">
                  • Invite Only
                </span>
              )}
              {currentRoom.isStreaming && (
                <span className="text-sm text-destructive flex items-center gap-1">
                  <Radio className="w-4 h-4 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>

            {/* Controls */}
            <div className="flex gap-2">
              <Button
                onClick={toggleAudio}
                variant={isAudioEnabled ? 'default' : 'destructive'}
                size="icon"
              >
                {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </Button>

              <Button
                onClick={toggleVideo}
                variant={isVideoEnabled ? 'default' : 'destructive'}
                size="icon"
              >
                {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </Button>

              {currentRoom.hostId === currentRoom.participants[0] && (
                <>
                  {!currentRoom.isStreaming ? (
                    <Button onClick={handleStartStreaming} variant="secondary">
                      <Radio className="w-4 h-4 mr-2" />
                      Start Streaming to Feed
                    </Button>
                  ) : (
                    <Button onClick={handleStopStreaming} variant="secondary">
                      <Radio className="w-4 h-4 mr-2" />
                      Stop Streaming
                    </Button>
                  )}
                </>
              )}

              <Button 
                onClick={handleLeaveRoom} 
                variant="destructive"
                className="ml-auto"
              >
                Leave Room
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
