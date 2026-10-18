/** Only a verified external account wakes the mesh gateway. */
export function syncWalletGateway(
  address: string | null,
  gateway: { startGatewayCell: () => void; stopGatewayCell: () => void },
): void {
  if (address) gateway.startGatewayCell();
  else gateway.stopGatewayCell();
}