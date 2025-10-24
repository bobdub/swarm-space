import { User } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { get } from "@/lib/store";
import { decryptAndReassembleFile, genFileKey, Manifest } from "@/lib/fileEncryption";

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

  useEffect(() => {
    if (!avatarRef) return;

    const loadAvatar = async () => {
      try {
        const manifest = await get("manifests", avatarRef) as Manifest;
        if (manifest) {
          const fileKey = await genFileKey();
          const blob = await decryptAndReassembleFile(manifest, fileKey);
          setAvatarUrl(URL.createObjectURL(blob));
        }
      } catch (error) {
        console.error("Failed to load avatar:", error);
      }
    };

    loadAvatar();

    return () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    };
  }, [avatarRef]);

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
