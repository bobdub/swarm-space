# Hybrid P2P Transport Architecture

## Overview

The Swarm Space network now uses a **hybrid multi-transport architecture** that combines multiple P2P technologies working in tandem for maximum resilience, connectivity, and blockchain synchronization.

## Technology Stack

### Primary Layer: Integrated Adapter
**Components:** WebTorrent DHT + Gun.js + WebRTC DataChannels

- **WebTorrent DHT**: Peer discovery via distributed hash table
- **Gun.js**: Decentralized signaling and mesh relay
- **WebRTC**: Direct peer-to-peer data channels

**Advantages:**
- Zero-config peer discovery
- Mesh relay for NAT traversal
- Direct P2P when possible, relay when needed

### Secondary Layer: Gun.js Standalone
**Pure mesh relay network**

- Always-on fallback relay
- Works even when WebRTC fails
- Offline-first data synchronization

**Advantages:**
- Extremely resilient
- Works across difficult NAT scenarios
- No signaling server dependency

### Tertiary Layer: PeerJS (Legacy Fallback)
**Cloud-assisted WebRTC signaling**

- Maintained for backward compatibility
- Stable fallback when mesh is unavailable
- Zero-config cloud signaling

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│          Hybrid P2P Orchestrator                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Adaptive Routing Engine                        │   │
│  │  - Learns transport reliability                 │   │
│  │  - Automatic fallback                           │   │
│  │  - Circuit breaker recovery                     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  Integrated  │  │   Gun.js     │  │   PeerJS    │  │
│  │   Adapter    │  │  Standalone  │  │  (Legacy)   │  │
│  │  (PRIMARY)   │  │ (SECONDARY)  │  │ (FALLBACK)  │  │
│  └──────────────┘  └──────────────┘  └─────────────┘  │
│         │                 │                  │          │
│         ▼                 ▼                  ▼          │
│  ┌──────────────────────────────────────────────────┐  │
│  │     WebRTC         Gun          PeerJS           │  │
│  │  DataChannels    Mesh Relay   Cloud Signaling   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Blockchain P2P Sync                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Syncs across ALL connected transports:         │   │
│  │  - Reward pool state                            │   │
│  │  - Blockchain blocks                            │   │
│  │  - Transaction pool                             │   │
│  │  - Profile tokens                               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Connection Resilience

### Circuit Breaker Pattern
Prevents connection cascade failures:

1. **Closed State**: Normal operation
2. **Open State**: After 5 failures, stop trying for 60 seconds
3. **Half-Open State**: Try limited connections to test recovery
4. **Auto-Recovery**: Successful connections close the breaker

### Exponential Backoff
Failed connections back off exponentially:
- Base delay: 1 second
- Max delay: 5 minutes
- Formula: `delay = min(base * 2^failures, max)`

### Adaptive Routing
The orchestrator learns which transport works best:
- Tracks reliability scores (0-1) per transport
- Routes through most reliable transport first
- Adjusts scores based on success/failure rates
- Falls back to next-best transport on failure

## Blockchain Integration

All blockchain data synchronizes across **every connected transport**:

### Sync Mechanisms
1. **Periodic Sync**: Every 2 minutes, request full chain from peers
2. **Event-Driven**: New blocks broadcast immediately
3. **Reward Pool**: Donations sync to all connected peers
4. **Conflict Resolution**: Longest valid chain wins

### Cross-Transport Benefits
- **Redundancy**: Block data available via multiple paths
- **Speed**: Fastest transport delivers first
- **Resilience**: Network survives transport failures
- **Mesh Healing**: Peers sync even when some transports are down

## Message Flow

### Sending a Message
```
User sends message
  └─> Hybrid Orchestrator
      ├─> Try Integrated (reliability: 1.0)
      │   ├─> WebRTC DataChannel (if connected) ✅
      │   └─> Gun relay (if WebRTC fails) ✅
      ├─> Try Gun Standalone (reliability: 0.8)
      │   └─> Mesh relay ✅
      └─> Try PeerJS (reliability: 0.6)
          └─> Cloud-assisted WebRTC ✅
```

### Receiving a Message
```
Message arrives on ANY transport
  └─> Hybrid Orchestrator
      └─> Deduplicate (same message from multiple transports)
          └─> Deliver to handlers once
```

## Bootstrap & Discovery

### Auto-Connect Peer List
Hardcoded stable peers bootstrap the network:
- `peer-c99d22420d76-mhjpqwnr-9n02yin`
- `peer-fc6ea1c770f8-mhjpq7fc-trrbbig`

### Discovery Cascade
1. **Bootstrap Registry**: Try known stable peers
2. **WebTorrent DHT**: Discover peers in swarm
3. **Gun Mesh**: Discover peers via relay network
4. **PeerJS Cloud**: Discover peers via signaling server

## Performance Characteristics

| Transport | Latency | Reliability | NAT Traversal | Offline Support |
|-----------|---------|-------------|---------------|-----------------|
| Integrated (WebRTC) | ~50ms | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| Integrated (Gun) | ~200ms | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Gun Standalone | ~200ms | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| PeerJS | ~100ms | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ |

## Benefits of Hybrid Architecture

### 1. **Resilience**
- Multiple connection paths to each peer
- Network survives individual transport failures
- Automatic fallback and recovery

### 2. **Speed**
- Routes through fastest available transport
- Parallel attempts across transports
- Learns optimal paths over time

### 3. **Compatibility**
- Works in restrictive network environments
- NAT traversal via multiple strategies
- Offline-first mesh relay

### 4. **Blockchain Integrity**
- Blockchain data syncs across all transports
- Redundant sync paths prevent data loss
- Faster propagation via multiple routes

## Configuration

### Enable Hybrid Mode
Already enabled by default in the application.

### Adjust Transport Priorities
Modify `transportReliability` in `HybridOrchestrator`:
```typescript
private transportReliability = new Map<TransportPriority, number>([
  ['integrated', 1.0],  // Primary
  ['gun', 0.8],         // Secondary
  ['peerjs', 0.6],      // Fallback
]);
```

### Configure Circuit Breakers
Adjust in `ConnectionResilience`:
```typescript
const config: ResilienceConfig = {
  failureThreshold: 5,
  openStateTimeout: 60000,
  halfOpenSuccessThreshold: 3,
  maxBackoffMs: 300000,
  baseBackoffMs: 1000,
};
```

## Monitoring

### Transport Health
Check current transport status:
```typescript
const status = orchestrator.getTransportStatus();
console.log(status.primary); // Current primary transport
console.log(status.health);  // Health of all transports
```

### Circuit Breaker Stats
```typescript
const resilience = getConnectionResilience();
const stats = resilience.getStats();
console.log(`Open breakers: ${stats.openBreakers}`);
```

### Blockchain Sync Status
```typescript
const syncStats = blockchainSync.getStats();
console.log(`Sync running: ${syncStats.isRunning}`);
```

## Troubleshooting

### All Transports Failing
1. Check browser console for errors
2. Verify network connectivity
3. Check if NAT/firewall is blocking
4. Try resetting circuit breakers manually

### Blockchain Not Syncing
1. Verify transports are connected
2. Check peer count (need at least 1 peer)
3. Manually trigger sync: `blockchainSync.triggerSync()`
4. Check reward pool storage in IndexedDB

### High Circuit Breaker Count
1. Network instability - wait for recovery
2. Peer churn - normal in dynamic networks
3. Manual reset if needed: `resilience.forceReset(peerId)`

## Future Enhancements

- [ ] WebRTC mesh routing (relay via connected peers)
- [ ] IPFS integration for content distribution
- [ ] Tor/I2P transport layer for privacy
- [ ] Satellite mesh for offline-first rural connectivity
- [ ] Bluetooth mesh for local device clustering

## Conclusion

The hybrid architecture provides **maximum resilience** by using all available P2P technologies in tandem, with intelligent routing, automatic fallback, and cross-transport blockchain synchronization. This ensures the Swarm Space network remains connected and functional even in challenging network conditions.
