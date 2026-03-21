import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NFTMetadata } from "@/lib/blockchain/types";
import { get } from "@/lib/store";
import { importKeyRaw, decryptAndReassembleFile } from "@/lib/fileEncryption";
import type { Manifest } from "@/lib/fileEncryption";
import { ImageIcon } from "lucide-react";

interface NFTCardProps {
  nft: NFTMetadata;
}

export function NFTCard({ nft }: NFTCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!nft.image?.startsWith("manifest:")) return;

    const manifestId = nft.image.replace("manifest:", "");
    let revoke: string | null = null;

    const loadImage = async () => {
      try {
        const manifest = (await get("manifests", manifestId)) as Manifest | undefined;
        if (!manifest?.fileKey) return;
        const fileKey = await importKeyRaw(manifest.fileKey);
        const blob = await decryptAndReassembleFile(manifest, fileKey);
        const url = URL.createObjectURL(blob);
        revoke = url;
        setImageUrl(url);
      } catch {
        // File not available yet
      }
    };

    void loadImage();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [nft.image]);

  return (
    <Card className="overflow-hidden">
      {imageUrl ? (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={imageUrl}
            alt={nft.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : nft.image?.startsWith("manifest:") ? (
        <div className="flex aspect-video w-full items-center justify-center bg-muted/50">
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      ) : null}
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{nft.name}</CardTitle>
        {nft.rarity && (
          <Badge variant="outline" className="w-fit">{nft.rarity}</Badge>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">{nft.description}</p>
        <div className="space-y-1">
          {nft.attributes.map((attr, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{attr.trait_type}</span>
              <span className="font-medium">{attr.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
