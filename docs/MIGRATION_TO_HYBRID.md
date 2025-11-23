# Migration Guide: Legacy → Hybrid P2P Architecture

## Overview

This guide explains how to safely migrate from the legacy P2P stack to the new hybrid multi-transport architecture without disrupting existing connections.

## What Changed?

### Before (Legacy Stack)
```
PeerJS (Primary)
  └─> WebRTC DataChannels
  └─> Fallback to Gun/WebTorrent (manual, sequential)
```

### After (Hybrid Stack)
```
Hybrid Orchestrator
  ├─> Integrated Adapter (PRIMARY)
  │   ├─> WebTorrent DHT Discovery
  │   ├─> Gun.js Signaling
  │   └─> WebRTC DataChannels
  ├─> Gun Standalone (SECONDARY)
  │   └─> Pure mesh relay
  └─> PeerJS (FALLBACK)
      └─> Cloud-assisted WebRTC
```

## Migration Strategy

### Phase 1: Feature Flags (CURRENT)
The new hybrid system is **enabled by default** but runs alongside the legacy stack:

```typescript
const flags = {
  hybridOrchestrator: true,      // Enable hybrid transport
  connectionResilience: true,     // Enable circuit breakers
  integratedTransport: true,      // Keep integrated adapter
};
```

**Behavior:**
- Hybrid orchestrator handles new connections
- Legacy PeerJS handles fallback
- Both stacks run in parallel
- No breaking changes

### Phase 2: Gradual Rollout (NEXT)
Once hybrid proves stable:

1. Monitor hybrid transport health
2. Collect metrics on transport reliability
3. Identify and fix edge cases
4. Gradually increase hybrid usage %

### Phase 3: Full Migration (FUTURE)
After stability period:

1. Make hybrid the only transport
2. Remove legacy PeerJS direct calls
3. Keep PeerJS as tertiary fallback only
4. Clean up redundant code

## Feature Flags

### Enable Hybrid Orchestrator
```typescript
import { setFeatureFlag } from '@/config/featureFlags';

// Enable hybrid orchestration
setFeatureFlag('hybridOrchestrator', true);

// Enable circuit breaker resilience
setFeatureFlag('connectionResilience', true);
```

### Disable for Rollback
```typescript
// Disable hybrid (revert to legacy)
setFeatureFlag('hybridOrchestrator', false);
setFeatureFlag('connectionResilience', false);
```

## Monitoring

### Transport Health
Check which transport is currently primary:
```typescript
const integration = getHybridIntegration();
const status = integration?.getTransportStatus();

console.log('Primary transport:', status?.primary);
console.log('Total peers:', status?.totalPeers);
console.log('Health:', status?.health);
```

### Circuit Breaker Stats
Monitor connection resilience:
```typescript
const stats = integration?.getResilienceStats();

console.log('Open breakers:', stats?.openBreakers);
console.log('Half-open breakers:', stats?.halfOpenBreakers);
console.log('Total breakers:', stats?.totalBreakers);
```

### Check Individual Peer
```typescript
const state = integration?.getCircuitBreakerState(peerId);

if (state) {
  console.log('Peer:', peerId);
  console.log('State:', state.state); // 'closed' | 'open' | 'half-open'
  console.log('Failures:', state.failures);
  console.log('Last failure:', new Date(state.lastFailure));
}
```

## Troubleshooting

### Too Many Circuit Breakers Open
**Symptom:** High number of open circuit breakers

**Cause:** Network instability or peer churn

**Solution:**
```typescript
// Reset all breakers (admin action)
const integration = getHybridIntegration();
integration?.resetAllCircuitBreakers();
```

### Hybrid Transport Not Working
**Symptom:** Falling back to PeerJS frequently

**Check:**
1. Browser console for transport errors
2. IndexedDB for reward pool persistence
3. Network connectivity to Gun peers

**Debug:**
```typescript
const status = integration?.getTransportStatus();
console.log('Transport health:', status?.health);

// Check each transport individually
for (const [transport, health] of status?.health || []) {
  console.log(transport, {
    state: health.status.state,
    error: health.status.lastError,
    peers: health.connectedPeers,
  });
}
```

### Blockchain Not Syncing
**Symptom:** Reward pool not updating across peers

**Check:**
1. At least one peer connected
2. Hybrid transport active
3. Blockchain sync running

**Debug:**
```typescript
// Check if blockchain sync is running
const { BlockchainP2PSync } = await import('./lib/blockchain/p2pSync');
// Sync stats available via getStats()
```

## Rollback Plan

If issues arise, rollback is simple:

### Step 1: Disable Hybrid
```typescript
import { setFeatureFlag } from '@/config/featureFlags';

setFeatureFlag('hybridOrchestrator', false);
setFeatureFlag('connectionResilience', false);
```

### Step 2: Clear Circuit Breakers
```typescript
import { resetConnectionResilience } from '@/lib/p2p/connectionResilience';

resetConnectionResilience();
```

### Step 3: Restart P2P
```typescript
// Disable and re-enable P2P
const { useP2PContext } = await import('@/contexts/P2PContext');
const p2p = useP2PContext();

p2p.disable();
await p2p.enable();
```

## Benefits After Migration

### 1. Better Connectivity
- Multiple connection paths to each peer
- Automatic failover between transports
- Circuit breaker prevents connection storms

### 2. Improved Resilience
- Network survives individual transport failures
- Adaptive routing learns best paths
- Exponential backoff prevents cascade failures

### 3. Faster Blockchain Sync
- Blockchain data syncs across all transports
- Redundant sync paths prevent data loss
- Faster propagation via parallel routes

### 4. Easier Debugging
- Centralized transport health monitoring
- Circuit breaker visibility
- Transport reliability metrics

## Testing Checklist

Before migrating production:

- [ ] Test in development environment
- [ ] Verify peer connections established
- [ ] Confirm blockchain syncing works
- [ ] Check circuit breakers recover automatically
- [ ] Monitor transport health for 24 hours
- [ ] Test with varying network conditions
- [ ] Verify rollback procedure works
- [ ] Document any edge cases found

## Support

If you encounter issues:

1. Check console logs for errors
2. Review transport health stats
3. Verify feature flags are set correctly
4. Test with circuit breakers reset
5. Try disabling hybrid as temporary workaround

## Timeline

- **Week 1-2**: Monitor hybrid in parallel with legacy
- **Week 3-4**: Identify and fix issues
- **Week 5-6**: Increase hybrid usage %
- **Week 7+**: Full migration, remove legacy

## Conclusion

The hybrid architecture provides significant improvements in reliability, speed, and resilience. The migration is designed to be gradual, safe, and easily reversible if needed.
