# Call stability

- Queue local offers until signaling is stable; never force-release an in-flight lock or count delayed mesh answers as failures, because competing negotiations cause reconnect loops.
- Received camera/mic streams hold one live track per kind and change identity on replacement; ignore obsolete connection events so playback never binds to stale recovery tracks.
- Automated health checks respect active negotiation, disconnect grace, recovery ownership and intentional mute; keep manual resync explicit so routine sweeps do not tear down working calls.
- Mesh voice uses room-scoped ephemeral ECDH/AES-GCM frames, receiver-requested failover from inbound RTP byte growth, a shared call AudioContext, bounded relay/backlog and no persisted audio; relays cannot read audio and recovered RTP must never play twice.