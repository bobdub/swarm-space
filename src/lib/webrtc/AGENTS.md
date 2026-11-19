# Call stability

- Queue local offers until signaling is stable; never force-release an in-flight lock or count delayed mesh answers as failures, because competing negotiations cause reconnect loops.
- Received camera/mic streams hold one live track per kind and change identity on replacement; ignore obsolete connection events so playback never binds to stale recovery tracks.
- Automated health checks respect active negotiation, disconnect grace, recovery ownership and intentional mute; keep manual resync explicit so routine sweeps do not tear down working calls.