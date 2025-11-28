/**
 * Block User Modal
 * Simple modal to block a peer/user from the network
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

interface BlockUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBlock: (peerId: string) => void;
}

export function BlockUserModal({ open, onOpenChange, onBlock }: BlockUserModalProps) {
  const [peerId, setPeerId] = useState("");

  const handleBlock = () => {
    if (!peerId.trim()) return;
    onBlock(peerId.trim());
    setPeerId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-destructive" />
            Block User
          </DialogTitle>
          <DialogDescription>
            Block a peer/user from the network. This will prevent you from seeing their posts,
            comments, and interactions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="peer-id">Peer ID</Label>
            <Input
              id="peer-id"
              placeholder="Enter peer ID to block..."
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleBlock();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleBlock} disabled={!peerId.trim()}>
            <Shield className="mr-2 h-4 w-4" />
            Block User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
