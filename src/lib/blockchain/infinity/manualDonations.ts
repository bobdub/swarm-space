/**
 * Donations made outside the SWARM ledger, recorded by hand so they show on
 * the bar's donor leaderboard: ETH or BTC sent to the external donation
 * addresses, gift cards, cash, bank transfers, anything else.
 *
 * Only people who can change this repository can edit this list, so nobody
 * can fake an entry from inside the app. Every peer runs the same build, so
 * every peer sees the same board once the change is deployed.
 *
 * To add a donation, append an entry below:
 *
 *   {
 *     donor: "Ada",                 // name shown on the board
 *     userId: "…",                  // optional: their Swarm user id, so this
 *                                   //   merges with their on-mesh donations
 *     amount: 0.05,
 *     currency: "ETH",              // ETH, BTC, USD, EUR, GBP, … any ticker
 *     method: "ETH transfer",       // optional: "gift card", "BTC", "cash"…
 *     date: "2026-11-24",           // when it was given (YYYY-MM-DD)
 *     reference: "0xabc…",          // optional: tx hash or receipt id
 *     swarmValue: 500,              // optional: its worth in SWARM, for the
 *                                   //   ranking (needed for fiat and gift cards;
 *                                   //   ETH, BTC and MINTME use market prices)
 *   },
 *
 * Fiat currencies (USD, EUR, GBP) display with their symbol, e.g. "$25".
 */
export interface ManualDonation {
  /** Name shown on the board. */
  donor: string;
  /** The donor's Swarm user id, when they have one, to merge with their on-mesh gifts. */
  userId?: string;
  amount: number;
  /** Ticker or currency code, e.g. "ETH", "BTC", "USD". */
  currency: string;
  /** How it was given, e.g. "gift card". Not shown on the board. */
  method?: string;
  /** When it was given, as an ISO date (YYYY-MM-DD) or timestamp. */
  date: string;
  /** Transaction hash or receipt id, for your own records. Not shown on the board. */
  reference?: string;
  /**
   * What the gift is worth in SWARM, for ranking. Without it, ETH, BTC and
   * MINTME are valued at the coin market's price and anything else at 0.
   */
  swarmValue?: number;
}

export const MANUAL_DONATIONS: ManualDonation[] = [
];
