import { describe, it, expect, beforeEach, vi } from "vitest";
import { _resetPlayModeForTest } from '@/lib/world/playMode';

vi.mock("@/config/featureFlags", () => ({ getFeatureFlags: () => ({ scaffoldBus: true }) }));
vi.mock("@/lib/uqrc/fieldEngine", () => ({ getSharedFieldEngine: () => ({ inject: () => {} }) }));

import { emitScaffold, __resetScaffoldBusForTests } from "@/lib/uqrc/scaffoldBus";
import {
  bootLabourLedger, getLabourLedger, _flushLabourLedgerForTest, _resetLabourLedgerForTest,
} from "../labourLedger";
import {
  getHarvested, hydrateHarvestedInventory, recordHarvest, _flushHarvestedForTest, _resetHarvestedForTest,
} from "@/lib/remix/harvestedInventory";

const fill = (actor: string, delta: number) =>
  emitScaffold({ domain: "coin", type: "fill", coinId: `labour:${actor}`, ownerId: actor, delta });

beforeEach(() => {
  localStorage.clear();
  __resetScaffoldBusForTests();
  _resetLabourLedgerForTest();
  _resetHarvestedForTest();
  _resetPlayModeForTest({ online: true });
});

describe("labour ledger across a refresh", () => {
  it("keeps the player's and NPC totals after reload", async () => {
    await bootLabourLedger();
    fill("me", 0.05);
    fill("me", 0.05);
    fill("npc-1", 0.04);
    _flushLabourLedgerForTest(); // page unload

    // Reload: fresh module state, same storage.
    __resetScaffoldBusForTests();
    _resetLabourLedgerForTest();
    await bootLabourLedger();
    const snap = getLabourLedger();
    expect(snap.totals.me).toBeCloseTo(0.1);
    expect(snap.totals["npc-1"]).toBeCloseTo(0.04);
    expect(snap.recent).toHaveLength(3);
  });

  it("adds fills that land while the stored snapshot loads instead of dropping them", async () => {
    await bootLabourLedger();
    fill("me", 0.2);
    _flushLabourLedgerForTest();
    __resetScaffoldBusForTests();
    _resetLabourLedgerForTest();

    const booting = bootLabourLedger();
    fill("me", 0.05); // arrives before hydration finishes
    await booting;
    expect(getLabourLedger().totals.me).toBeCloseTo(0.25);
  });

  it("does not wipe stored totals when the page hides before loading finishes", async () => {
    await bootLabourLedger();
    fill("me", 0.3);
    _flushLabourLedgerForTest();
    __resetScaffoldBusForTests();
    _resetLabourLedgerForTest();

    const booting = bootLabourLedger();
    _flushLabourLedgerForTest(); // hidden before hydration: must not save an empty ledger
    await booting;
    expect(getLabourLedger().totals.me).toBeCloseTo(0.3);
  });
});

describe("harvested inventory across a refresh", () => {
  it("restores counts written moments before reload", async () => {
    await hydrateHarvestedInventory();
    const base = getHarvested("C");
    recordHarvest("C", 2);
    _flushHarvestedForTest();

    _resetHarvestedForTest();

    _resetPlayModeForTest({ online: true });
    await hydrateHarvestedInventory();
    expect(getHarvested("C")).toBe(base + 2);
  });

  it("adds harvests made before the stored bag loads on top of it", async () => {
    await hydrateHarvestedInventory();
    recordHarvest("Si", 4);
    _flushHarvestedForTest();

    _resetHarvestedForTest();

    _resetPlayModeForTest({ online: true });
    recordHarvest("Si", 2); // before hydration
    await hydrateHarvestedInventory();
    expect(getHarvested("Si")).toBe(6);
  });

  it("seeds starter atoms only on a true first run", async () => {
    await hydrateHarvestedInventory();
    expect(getHarvested("H")).toBe(24);
    recordHarvest("H", -24);
    _flushHarvestedForTest();
    _resetHarvestedForTest();
    _resetPlayModeForTest({ online: true });
    await hydrateHarvestedInventory();
    expect(getHarvested("H")).toBe(0);
  });
});
