import { expect, test } from "bun:test";
import { syncWalletGateway } from "./walletGatewayLifecycle";

test("a connected external MetaMask account automatically starts the cell", () => {
  const actions: string[] = [];
  syncWalletGateway("0x1234", {
    startGatewayCell: () => actions.push("start"),
    stopGatewayCell: () => actions.push("stop"),
  });
  expect(actions).toEqual(["start"]);
});

test("disconnecting MetaMask makes the cell dormant", () => {
  const actions: string[] = [];
  syncWalletGateway(null, {
    startGatewayCell: () => actions.push("start"),
    stopGatewayCell: () => actions.push("stop"),
  });
  expect(actions).toEqual(["stop"]);
});