

# Clean Up Duplicate Connect Fields in P2P Status Dropdown

## Problem
When all bootstrap nodes are offline, the wifi dropdown shows **two** connect-to-peer input fields simultaneously:
1. The red "No verified nodes online" fallback alert with its own input (line 581-611)
2. The regular "Connect to user" section with its own input (line 613-640)

This is redundant and confusing.

## Fix

**File: `src/components/P2PStatusIndicator.tsx`**

Hide the "Connect to user" section when the bootstrap fallback alert is visible. The fallback alert already provides the same functionality (accepts both Node ID and Peer ID), so the regular connect field is redundant in that state.

Wrap the "Connect to user" `div` (lines 613-640) with a condition:

```
{!(bootstrapFailed && isEnabled && stats.connectedPeers === 0) && ( ... )}
```

This ensures only one connect input is ever visible -- the contextually appropriate one.

