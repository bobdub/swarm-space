import { useState, useEffect, useMemo } from "react";
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
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaMime, setMediaMime] = useState<string | null>(null);

  const mediaManifestId = useMemo(() => {
    if (nft.mediaManifestId) {
      return nft.mediaManifestId;
    }
    if (nft.image?.startsWith("manifest:")) {
      return nft.image.replace("manifest:", "");
    }
    return null;
  }, [nft.image, nft.mediaManifestId]);

  useEffect(() => {
    if (!mediaManifestId) {
      setMediaUrl(null);
      setMediaMime(null);
      return;
    }

    let revoke: string | null = null;
    let cancelled = false;

    const loadImage = async () => {
      try {
        const manifest = (await get("manifests", mediaManifestId)) as Manifest | undefined;
        if (!manifest?.fileKey) return;
        const fileKey = await importKeyRaw(manifest.fileKey);
        const blob = await decryptAndReassembleFile(manifest, fileKey);
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke = url;
        setMediaUrl(url);
        setMediaMime(blob.type || manifest.mime || nft.mediaMime || null);
      } catch {
        // File not available yet
      }
    };

    void loadImage();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [mediaManifestId, nft.mediaMime]);

  const resolvedMime = mediaMime ?? nft.mediaMime ?? null;
  const isImage = resolvedMime?.startsWith("image/") ?? false;
  const isVideo = resolvedMime?.startsWith("video/") ?? false;
  const isAudio = resolvedMime?.startsWith("audio/") ?? false;

  return (
    <Card className="overflow-hidden">
      {mediaUrl ? (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          {isImage && <img src={mediaUrl} alt={nft.name} className="h-full w-full object-cover" />}
          {isVideo && (
            <video src={mediaUrl} controls preload="metadata" className="h-full w-full object-cover">
              Your browser does not support video playback.
            </video>
          )}
          {isAudio && (
            <div className="flex h-full w-full items-center justify-center px-4">
              <audio src={mediaUrl} controls preload="metadata" className="w-full" />
            </div>
          )}
          {!isImage && !isVideo && !isAudio && (
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              Media preview unavailable
            </div>
          )}
        </div>
      ) : nft.image && !mediaManifestId ? (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img src={nft.image} alt={nft.name} className="h-full w-full object-cover" />
        </div>
      ) : mediaManifestId ? (
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
