---
name: Live Chat (Brain Chat) UI Sync
description: Live chat surface is now the BrainChatPanel; cross-tab open/closed state syncs over the swarm-brain-chat BroadcastChannel.
type: feature
---
The legacy floating Live Chat tray (StreamingRoomTray) has been replaced by the BrainChatPanel.
- Globally available via BrainChatLauncher (mounted in App.tsx); hidden on /brain and /projects/:id/hub where the panel renders inline inside BrainUniverseScene.
- Cross-tab sync uses BroadcastChannel name "swarm-brain-chat" (replaces the old "swarm-live-chat-tray"). Messages: { type: "open-change", open: boolean } and { type: "unread", count: number }.
- End-of-stream archival (recording → feed post attach) lives in a headless StreamingBackgroundService component.
- Promote-to-feed button appears in the panel header only when useStreaming().activeRoom is set AND its id matches the panel's bound roomId.
