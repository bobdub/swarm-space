import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { addProfileTokens, applyCreatorTokenTips, getProfileTokenHolding } from "../profileTokenBalance";

const me = "aaaaaaaaaaaaaaaa";
const other = "bbbbbbbbbbbbbbbb";
const move = (id: string, from: string, to: string, amount: number) => ({ id, from, to, tokenId: "tok-1", ticker: "TOK", creatorUserId: other, amount });

it("applies each signed creator-token tip to the member's holding once, keeping that record through market credits", async () => {
  await addProfileTokens({ userId: me, tokenId: "tok-1", ticker: "TOK", creatorUserId: other, amount: 10 });
  expect(await applyCreatorTokenTips(me, [move("t1", other, me, 5), move("t2", me, other, 3), move("t3", other, "cccccccccccccccc", 9)])).toBe(2);
  expect((await getProfileTokenHolding(me, "tok-1"))?.amount).toBe(12);
  // Replays and re-synced blocks change nothing.
  expect(await applyCreatorTokenTips(me, [move("t1", other, me, 5), move("t2", me, other, 3)])).toBe(0);
  // A later market buy keeps the applied list, so the tips are still not applied twice.
  await addProfileTokens({ userId: me, tokenId: "tok-1", ticker: "TOK", creatorUserId: other, amount: 1 });
  expect(await applyCreatorTokenTips(me, [move("t1", other, me, 5)])).toBe(0);
  expect((await getProfileTokenHolding(me, "tok-1"))?.amount).toBe(13);
  // A first tip in creates the holding.
  await applyCreatorTokenTips(me, [{ ...move("t4", other, me, 2), tokenId: "tok-2", ticker: "NEW" }]);
  expect(await getProfileTokenHolding(me, "tok-2")).toMatchObject({ amount: 2, ticker: "NEW", creatorUserId: other });
});
