---
name: Brain mute and block tools
description: Brain Chat name-click user tools — local Mute hides audio/video/avatar/placements/chat on this device; Block uses the P2P blocklist and also mutes. Muted chat collapses to one "Message from muted user (Unmute?)" placeholder per user.
type: feature
---

Brain Chat user tools (added 2026-10-25):

- Clicking a username in Brain Chat (message header or users rail) opens a
  popover: Mention, Mute/Unmute, Block/Unblock. Infinity and self lines are
  excluded.
- **Mute** is local-only (`src/lib/brain/mutedPeersStore.ts`, localStorage
  `brain:muted-peers:v1`): hides the peer's audio (PersistentAudioLayer
  `muted` attr), camera tile (BrainVideoGrid filter), avatar
  (RemoteAvatarLayer filter), world placements (UserPlacementsLayer filter
  on `actorId`) and chat messages — on this device only, never severs the
  mesh edge.
- **Block** uses the P2P blocklist (`blockPeer(peerId, 'all')`) AND writes a
  mute entry, so all render filters only consult the mute store. Unblock
  also unmutes.
- Muted users' chat messages collapse into ONE placeholder per user at
  their first hidden message: "Message from muted user (Unmute?)" —
  clicking "(Unmute?)" unmutes; all their other messages stay invisible.
  Blocked users get the same treatment with "(Unblock?)".
- Mute entries match by peerId OR userId because layers key the same person
  differently (avatars/audio/video use peerId, placements use actorId,
  chat lines carry both).
