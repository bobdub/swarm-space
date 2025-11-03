
1. Auto-Connect Feature

Objective: Simplify joining the main P2P mesh while keeping full user control.

Behavior & Flow:

Default: Auto-Connect is enabled when the user activates the P2P network.

Client attempts connection to a known moderator/dev peerID. 

✅ Success → connected to main mesh

❌ Failure → prompt user for manual connection to any available peer

Retry: Auto-Connect attempts automatically every 5 hours until successful or disabled.

2. User Controls

Users may disable Auto-Connect at any time; this stops all future auto attempts permanently.

Users retain full freedom to: 

Build their own mesh

Manually select peers

Use toggles to manage peer connections (Ignore / Block / Never Connect)

3. Connection Tools & Integration
System must remain consistent with moderator and user tools outlined in network documentation.

4. Fallback Behavior

Moderator/dev peerID offline → prompt manual connection

Manual connections do not interfere with auto-connect schedule unless disabled

Users always retain full mesh-building freedom

✅ Key Takeaways

Seamless: Auto-Connect simplifies joining the main mesh.

Flexible: Users have complete control and privacy over connections.

Resilient: Retry logic ensures connectivity even if moderator/dev peers are temporarily offline.

