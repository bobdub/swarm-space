import { User } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  decryptAndReassembleFile,
  importFileKey,
  type Manifest as EncryptedManifest,
} from "@/lib/fileEncryption";
import { useP2PContext } from "@/contexts/P2PContext";
import { get, type Manifest as StoredManifest } from "@/lib/store";

interface AvatarProps {
  avatarRef?: string;
  username?: string;
  displayName?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
};

export function Avatar({ avatarRef, username, displayName, size = "md", className }: AvatarProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const { ensureManifest } = useP2PContext();

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    if (!avatarRef) {
      setAvatarUrl(null);
      return () => {
        cancelled = true;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    }

    setAvatarUrl(null);

    const loadAvatar = async () => {
      try {
        let manifest = await get<StoredManifest>("manifests", avatarRef);

        const manifestIncomplete = !manifest?.fileKey || !manifest?.chunks?.length;
        if (!manifest || manifestIncomplete) {
          const ensured = await ensureManifest(avatarRef);
          if (ensured) manifest = ensured;
        }

        if (!manifest) {
          if (!cancelled) setAvatarUrl(null);
          return;
        }

        if (!manifest.fileKey || !manifest.chunks?.length) {
          if (!cancelled) setAvatarUrl(null);
          return;
        }

        // Attempt decryption — if chunks are missing, pull them and retry once
        const tryDecrypt = async (): Promise<Blob | null> => {
          try {
            const fileKey = await importFileKey(manifest!);
            const manifestForDecryption: EncryptedManifest = {
              ...manifest!,
              mime: manifest!.mime || "image/png",
              size: manifest!.size || 0,
              originalName: manifest!.originalName || "avatar",
            };
            return await decryptAndReassembleFile(manifestForDecryption, fileKey);
          } catch (e) {
            if (e instanceof Error && e.message.includes("not found")) {
              return null; // chunk missing
            }
            throw e;
          }
        };

        let blob = await tryDecrypt();

        // If decryption failed due to missing chunks, pull once from mesh and retry.
        if (!blob && !cancelled) {
          await ensureManifest(avatarRef);
          manifest = await get<StoredManifest>("manifests", avatarRef);
          if (manifest?.fileKey && manifest?.chunks?.length) {
            blob = await tryDecrypt();
          }
        }

        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setAvatarUrl(objectUrl);
        } else if (!cancelled) {
          setAvatarUrl(null);
        }
      } catch (error) {
        // Quiet by default — avatar failures are expected when chunks are absent.
        if (!cancelled) {
          setAvatarUrl(null);
        }
      }
    };

    loadAvatar();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [avatarRef, displayName, ensureManifest, username]);

  const initials = displayName?.[0]?.toUpperCase() || username?.[0]?.toUpperCase() || "?";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${displayName || username}'s avatar`}
        className={cn(
          "rounded-full object-cover border-2 border-[hsla(326,71%,62%,0.35)] shadow-[0_0_25px_hsla(326,71%,62%,0.28)]",
          sizeClasses[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border-2 border-[hsla(326,71%,62%,0.35)] bg-[hsla(253,82%,6%,0.85)] text-[hsl(326,71%,62%)] shadow-[0_0_25px_hsla(326,71%,62%,0.28)] font-semibold",
        sizeClasses[size],
        className
      )}
    >
      {username || displayName ? initials : <User className="h-1/2 w-1/2" />}
    </div>
  );
}
