import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { StreamParticipantRole } from "@/types/streaming";

interface InviteUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  roomTitle: string;
}

export function InviteUsersModal({
  isOpen,
  onClose,
  roomId,
  roomTitle,
}: InviteUsersModalProps) {
  const [inviteHandle, setInviteHandle] = useState("");
  const [inviteRole, setInviteRole] = useState<StreamParticipantRole>("listener");
  const [invitedUsers, setInvitedUsers] = useState<Array<{ handle: string; role: StreamParticipantRole }>>([]);
  const [isSending, setIsSending] = useState(false);

  const handleAddInvite = () => {
    if (!inviteHandle.trim()) {
      toast.error("Please enter a username");
      return;
    }

    const normalizedHandle = inviteHandle.trim().replace(/^@/, "");
    
    if (invitedUsers.some(inv => inv.handle === normalizedHandle)) {
      toast.error("User already invited");
      return;
    }

    setInvitedUsers([...invitedUsers, { handle: normalizedHandle, role: inviteRole }]);
    setInviteHandle("");
    toast.success(`Added @${normalizedHandle} to invite list`);
  };

  const handleRemoveInvite = (handle: string) => {
    setInvitedUsers(invitedUsers.filter(inv => inv.handle !== handle));
  };

  const handleSendInvites = async () => {
    if (invitedUsers.length === 0) {
      toast.error("Add at least one user to invite");
      return;
    }

    setIsSending(true);
    try {
      // TODO: Implement actual invite API call
      // For now, just simulate sending
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Create notifications for invited users
      invitedUsers.forEach(user => {
        const notification = {
          id: `invite-${roomId}-${user.handle}-${Date.now()}`,
          type: "stream-invite" as const,
          roomId,
          roomTitle,
          handle: user.handle,
          role: user.role,
          createdAt: new Date().toISOString(),
        };
        
        // Broadcast notification via P2P
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("stream-invitation-sent", {
            detail: notification,
          }));
        }
      });

      toast.success(`Sent ${invitedUsers.length} invitation${invitedUsers.length > 1 ? "s" : ""}`);
      setInvitedUsers([]);
      onClose();
    } catch (error) {
      console.error("[InviteUsersModal] Failed to send invites:", error);
      toast.error("Failed to send invitations");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Users</DialogTitle>
          <DialogDescription>
            Invite users to join "{roomTitle}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-handle">Username</Label>
            <div className="flex gap-2">
              <Input
                id="invite-handle"
                placeholder="@username"
                value={inviteHandle}
                onChange={(e) => setInviteHandle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddInvite();
                  }
                }}
              />
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as StreamParticipantRole)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="listener">Listener</SelectItem>
                  <SelectItem value="speaker">Speaker</SelectItem>
                  <SelectItem value="cohost">Co-host</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddInvite}
              className="w-full"
            >
              Add to invite list
            </Button>
          </div>

          {invitedUsers.length > 0 && (
            <div className="space-y-2">
              <Label>Invited users ({invitedUsers.length})</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-white/10 p-2">
                {invitedUsers.map((user) => (
                  <div
                    key={user.handle}
                    className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">@{user.handle}</span>
                      <Badge variant="outline" className="capitalize">
                        {user.role}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveInvite(user.handle)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSendInvites}
            disabled={invitedUsers.length === 0 || isSending}
          >
            Send Invitations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
