---
name: Live-Stream Post Box
description: Live-stream posts render as an in-feed LivePostBox (brain preview + classic chat + A/V controls). Join Live Brain opens immersive BrainUniverseScene as an overlay; leave returns to the post box. Scoped to live-stream posts only — /brain lobby and project hubs unchanged.
type: feature
---
- Component: src/components/streaming/LivePostBox.tsx. Rendered by StreamPostCardContent when isLive && !isEnded && isParticipant.
- Classic chat = BrainChatPanel with `variant="embedded"` + `chatMode="classic"`; suppresses Infinity persona, voice toggle, promote button.
- Immersive Join Live Brain mounts BrainUniverseScene via React portal at z-[80] with liveChatVariant; onLeave closes overlay, post box stays mounted so WebRTC tracks persist.
- BrainChatLauncher hides for rooms registered in src/lib/streaming/livePostBoxRegistry.ts.
- A/V smoothness: src/lib/streaming/avPriority.ts sets contentHint='speech'/'motion' on local tracks while the box is mounted; reset to '' on unmount.
- Host sees "End live" (setRoomBroadcastState ended); viewers see "Leave" (leaveRoom).