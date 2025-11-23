import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImagePlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getUserProfileToken } from "@/lib/blockchain/profileToken";
import { createNFTPost } from "@/lib/blockchain/nftPost";

interface NFTPostCreatorProps {
  onSuccess?: () => void;
}

export function NFTPostCreator({ onSuccess }: NFTPostCreatorProps) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [tokenAmount, setTokenAmount] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!user || !content.trim() || !title.trim()) {
      toast.error("Please provide both title and content");
      return;
    }

    if (tokenAmount < 1 || tokenAmount > 100) {
      toast.error("Token amount must be between 1 and 100");
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

      // Check if user has enough tokens
      if (profileToken.supply < tokenAmount) {
        toast.error(`Insufficient profile tokens. You have ${profileToken.supply} ${profileToken.ticker}`);
        return;
      }

      // Create NFT post as a regular post with locked tokens
      await createNFTPost({
        userId: user.id,
        title,
        content,
        tokenAmount,
        profileToken,
      });

      toast.success(`NFT post created with ${tokenAmount} ${profileToken.ticker} locked!`);
      setContent("");
      setTitle("");
      setTokenAmount(1);
      
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
      <div className="space-y-2">
        <Label htmlFor="token-amount">Profile Tokens to Lock</Label>
        <Input
          id="token-amount"
          type="number"
          min={1}
          max={100}
          value={tokenAmount}
          onChange={(e) => setTokenAmount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
          placeholder="1-100 tokens"
        />
        <p className="text-xs text-muted-foreground">
          Lock 1-100 profile tokens in this post. Users who hype it earn +1 token.
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
        This post will appear in your feed and on the network. Each hype rewards viewers with your profile token.
      </p>
    </div>
  );
}
