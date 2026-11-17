/**
 * Shared length limits for room / network chat lines.
 *
 * Chat travels over the PeerJS mesh data connections, which use PeerJS'
 * default BinaryPack serialization. PeerJS splits any payload larger than
 * its chunkedMTU (16,300 bytes) into ordered chunks and reassembles them on
 * the far side, so a 30,000-character line (up to ~120 KB of UTF-8) arrives
 * intact without app-level chunking. File chunks of 1 MiB already use the
 * same connections.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 30_000;

/**
 * Wire-side cap. Senders prefix the text with `${lineId}\u0001` so remote
 * echoes can be deduplicated, so the receiver allows a little headroom
 * above the composer limit before truncating.
 */
export const CHAT_WIRE_MAX_LENGTH = CHAT_MESSAGE_MAX_LENGTH + 128;
