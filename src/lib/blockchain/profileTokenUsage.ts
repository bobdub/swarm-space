import type { ProfileToken } from "./types";
import type { Post } from "@/types";

// Check if a profile token has been used to lock any NFT posts yet
export async function hasProfileTokenBeenUsed(userId: string, tokenId: string): Promise<boolean> {
  const { getAll } = await import("../store");
  const posts = await getAll<Post>("posts");

  return posts.some((post) => {
    const meta = (post as any).nftMetadata;
    return meta?.isNFTPost && meta.creatorUserId === userId && meta.tokenId === tokenId;
  });
}
