import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImagePlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { wrapAchievementAsNFT } from "@/lib/blockchain/nft";
import { getUserProfileToken } from "@/lib/blockchain/profileToken";

interface NFTPostCreatorProps {
  onSuccess?: () => void;
}

export function NFTPostCreator({ onSuccess }: NFTPostCreatorProps) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!user || !content.trim() || !title.trim()) {
      toast.error("Please provide both title and content");
      return;
    }

    try {
      setIsCreating(true);

      // Check if user has a profile token
      const profileToken = await getUserProfileToken(user.id);
      if (!profileToken) {
        toast.error("Deploy a profile token first to create NFT posts");
        return;
      }

      // Create NFT using achievement wrapper (temporary implementation)
      await wrapAchievementAsNFT({
        achievement: {
          id: crypto.randomUUID(),
          slug: "nft-post",
          title: title,
          description: content,
          creditReward: 0,
          qcmImpact: "NFT Post",
          category: "content",
          rarity: "rare",
        },
        progress: {
          id: crypto.randomUUID(),
          userId: user.id,
          achievementId: crypto.randomUUID(),
          unlocked: true,
          unlockedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
        owner: user.id,
      });

      toast.success("NFT post created on SWARM blockchain!");
      setContent("");
      setTitle("");
      
      // Call success callback to refresh wallet data
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("[NFT] Failed to create post:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create NFT post");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nft-title">Post Title</Label>
        <Input
          id="nft-title"
          placeholder="Give your NFT post a title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nft-content">Post Content</Label>
        <Textarea
          id="nft-content"
          placeholder="Write your exclusive content here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[120px]"
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground">
          {content.length}/500 characters
        </p>
      </div>
      <Button 
        onClick={handleCreate} 
        disabled={isCreating || !content.trim() || !title.trim()}
        className="w-full"
      >
        <ImagePlus className="mr-2 h-4 w-4" />
        {isCreating ? "Minting..." : "Mint NFT Post"}
      </Button>
      <p className="text-xs text-muted-foreground">
        This post will be minted as an NFT on the SWARM blockchain and added to your collection.
      </p>
    </div>
  );
}
