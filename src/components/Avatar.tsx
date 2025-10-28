import { User } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  decryptAndReassembleFile,
  importKeyRaw,
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
        console.log(`[Avatar] Loading avatar ${avatarRef} for ${displayName || username}`);
        let manifest = await get<StoredManifest>("manifests", avatarRef);

        const manifestIncomplete = !manifest?.fileKey || !manifest?.chunks?.length;
        if (!manifest || manifestIncomplete) {
          console.log(`[Avatar] Manifest ${avatarRef} incomplete or missing, requesting from P2P...`);
          const ensured = await ensureManifest(avatarRef);
          if (ensured) {
            console.log(`[Avatar] ✅ Successfully fetched manifest ${avatarRef} from P2P`);
            manifest = ensured;
          } else {
            console.warn(`[Avatar] ⚠️ Failed to fetch manifest ${avatarRef} from P2P network`);
          }
        } else {
          console.log(`[Avatar] Found complete manifest ${avatarRef} locally`);
        }

        if (!manifest) {
          console.warn(`[Avatar] No manifest available for ${avatarRef}`);
          if (!cancelled) {
            setAvatarUrl(null);
          }
          return;
        }

        if (!manifest.fileKey) {
          console.warn(`[Avatar] ❌ Avatar manifest ${avatarRef} is missing encryption key.`);
          if (!cancelled) {
            setAvatarUrl(null);
          }
          return;
        }

        if (!manifest.chunks || manifest.chunks.length === 0) {
          console.warn(`[Avatar] ❌ Avatar manifest ${avatarRef} does not contain any chunks.`);
          if (!cancelled) {
            setAvatarUrl(null);
          }
          return;
        }

        console.log(`[Avatar] Decrypting ${manifest.chunks.length} chunks for ${avatarRef}`);
        const fileKey = await importKeyRaw(manifest.fileKey);
        // Ensure manifest has required properties for decryption
        const manifestForDecryption: EncryptedManifest = {
          ...manifest,
          mime: manifest.mime || "image/png",
          size: manifest.size || 0,
          originalName: manifest.originalName || "avatar",
        };
        const blob = await decryptAndReassembleFile(manifestForDecryption, fileKey);
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          console.log(`[Avatar] ✅ Successfully loaded avatar ${avatarRef}`);
          setAvatarUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        console.error(`[Avatar] ❌ Failed to load avatar ${avatarRef}:`, error);
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
