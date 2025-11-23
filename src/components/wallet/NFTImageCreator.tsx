import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getUserProfileToken } from "@/lib/blockchain/profileToken";
import { createProfileTokenNFTImage } from "@/lib/blockchain/profileTokenNFTImage";

interface NFTImageCreatorProps {
  onSuccess?: () => void;
}

export function NFTImageCreator({ onSuccess }: NFTImageCreatorProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tokenAmount, setTokenAmount] = useState(1);
  const [imageData, setImageData] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImageData(result);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!user || !title.trim() || !imageData) {
      toast.error("Please provide title and image");
      return;
    }

    if (tokenAmount < 1) {
      toast.error("Token amount must be at least 1");
      return;
    }

    try {
      setIsCreating(true);

      // Check if user has a profile token
      const profileToken = await getUserProfileToken(user.id);
      if (!profileToken) {
        toast.error("Deploy a profile token first");
        return;
      }

      // Create NFT image
      await createProfileTokenNFTImage({
        userId: user.id,
        title,
        description,
        imageData,
        tokensToLock: tokenAmount,
      });

      toast.success(`NFT Image created with ${tokenAmount} ${profileToken.ticker} locked!`);
      setTitle("");
      setDescription("");
      setTokenAmount(1);
      setImageData("");
      setImagePreview("");
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("[NFT Image] Failed to create:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create NFT image");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nft-image-title">NFT Title</Label>
        <Input
          id="nft-image-title"
          placeholder="Give your NFT image a title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="nft-image-description">Description (Optional)</Label>
        <Textarea
          id="nft-image-description"
          placeholder="Describe your NFT image..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[80px]"
          maxLength={300}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nft-image-upload">Upload Image</Label>
        <div className="flex flex-col gap-3">
          <Input
            id="nft-image-upload"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="cursor-pointer"
          />
          {imagePreview && (
            <div className="border rounded-lg overflow-hidden">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-full h-auto max-h-64 object-cover"
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Max size: 5MB. Supported formats: JPG, PNG, GIF, WEBP
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nft-image-token-amount">Profile Tokens to Lock</Label>
        <Input
          id="nft-image-token-amount"
          type="number"
          min={1}
          value={tokenAmount}
          onChange={(e) => setTokenAmount(Math.max(1, parseInt(e.target.value) || 1))}
          placeholder="Number of tokens"
        />
        <p className="text-xs text-muted-foreground">
          Other users can unlock this NFT by spending the same amount of your tokens.
        </p>
      </div>

      <Button 
        onClick={handleCreate} 
        disabled={isCreating || !title.trim() || !imageData}
        className="w-full"
      >
        <ImagePlus className="mr-2 h-4 w-4" />
        {isCreating ? "Creating..." : "Create NFT Image"}
      </Button>
      
      <p className="text-xs text-muted-foreground">
        This NFT will be visible only to users who unlock it with your profile tokens.
      </p>
    </div>
  );
}
