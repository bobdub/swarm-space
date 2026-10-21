import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";

export default function ColdWalletGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNavigationBar />
      <main className="mx-auto max-w-3xl px-4 py-8 pb-24">
        <Button asChild variant="ghost" size="sm" className="mb-6 text-muted-foreground">
          <Link to="/settings"><ArrowLeft className="mr-2 h-4 w-4" />Settings documentation</Link>
        </Button>
        <article className="space-y-8 text-sm leading-relaxed">
          <header className="space-y-3 border-b border-border pb-6">
            <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-3xl font-bold">Native SWARM Blockchain Wallet</h1>
            <p className="text-lg text-muted-foreground">On-device custody with MetaMask connections</p>
            <p className="text-muted-foreground">A guide to custom MintMe token deposits, pending sync, and withdrawals.</p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Two records, one real holding</h2>
            <p>SWARM runs through peer-to-peer connections rather than a central SWARM server. Your Native wallet keeps local ledger records that can be shared with connected peers. MetaMask connects your external wallet to the app.</p>
            <p>For supported custom MintMe tokens, a deposit moves the real tokens on MintMe to an address controlled by your on-device cold key. SWARM records that holding for use inside its network. The token remains on MintMe; a SWARM ledger entry does not recreate it or move its contract to another blockchain.</p>
            <p>The cold-key receiving address is different from the Native SWARM address shown for in-network transfers. Use the deposit tool rather than manually sending external tokens to that displayed address.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Importing is not depositing</h2>
            <p>In your SWARM wallet, open <strong>Assets</strong> and select the <strong>MetaMask</strong> tab, then click <strong>Add custom token</strong> (connect MetaMask if prompted). The current custom-token flow supports MintMe only. The app saves the token after MetaMask approves adding it; a zero balance is valid for importing.</p>
            <p>Imported tokens stay listed on this device after a refresh. Deposit becomes available after a 15-second preparation period and requires a readable, positive MetaMask balance. Importing alone does not add a Native balance.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">From MetaMask to Native</h2>
            <ol className="list-decimal space-y-3 pl-5">
              <li><strong>Submit:</strong> choose an amount and approve the token transfer in MetaMask. MetaMask pays the MintMe transaction fee from that external account.</li>
              <li><strong>Confirm arrival:</strong> the app waits for a successful MintMe receipt and checks the token transfer to your cold-key address. A transaction hash alone is not a confirmed deposit.</li>
              <li><strong>Record:</strong> once arrival is confirmed, SWARM records the deposit locally. It can remain pending sync when no SWARM peer is connected.</li>
              <li><strong>Share:</strong> the deposit record is offered to the mesh when peers connect. The wallet separates pending-sync holdings from available holdings.</li>
            </ol>
            <p className="text-muted-foreground">Being disconnected from SWARM peers is not the same as being disconnected from the internet. MetaMask and the MintMe confirmation still need access to MintMe.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Hold &amp; Sync</h2>
            <dl className="space-y-3">
              <div><dt className="font-semibold">Pending sync</dt><dd>The confirmed deposit is held in your wallet but is not available for in-network custom-token transfers or Coin Vault deposits yet.</dd></div>
              <div><dt className="font-semibold">Available</dt><dd>The current sync gate has released the holding for supported SWARM uses. External custody and SWARM ledger sharing are separate steps.</dd></div>
            </dl>
            <p>A peer connection currently triggers the sync release. This is not proof that every peer has received the record, nor a network-wide guarantee against conflicting transactions.</p>
            <p>Your recorded Native holdings do not depend on keeping MetaMask connected. They are stored on your device; sharing with peers is not a substitute for protecting your identity backup.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Returning tokens to MetaMask</h2>
            <p>Connect MetaMask to prepare the destination address. You can edit it, but sending to the wrong address may be irreversible. Check both the address and the MintMe network before proceeding.</p>
            <p>Your existing Creator Coin Vault provides cold-key authority. Without one, the app offers a dedicated key container using 1 mined SWARM. That SWARM is locked in custody, not burned and not newly minted.</p>
            <p>The on-device cold key signs the outgoing MintMe transfer. MetaMask cannot approve a transfer from a key it does not control. It displays the arriving tokens after MintMe processes the transfer; there is no separate MetaMask acceptance handshake for an incoming token.</p>
            <p><strong>Gas:</strong> the cold-key address needs MINTME to pay for its outgoing transaction. MINTME held only in MetaMask does not automatically pay that fee, and SWARM cannot replace MINTME gas. Funding the cold-key address from MetaMask is a separate transaction that MetaMask asks you to approve.</p>
            <p>A pending-sync deposit can be returned without waiting for a SWARM peer, provided the cold key holds the tokens, has gas, and can reach MintMe. The app checks both the recorded Native balance and actual cold-key holdings. The current withdrawal path records the outgoing transaction after broadcast acceptance; broadcast is not final block confirmation.</p>
          </section>

          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="text-xl font-semibold">Protect your keys and check the limits</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>This is an on-device software wallet, not an offline hardware wallet. Keep your device secure and protect your account recovery material. Never share private keys or seed phrases.</li>
              <li>Only tokens actually held by your cold-key address can be returned through this withdrawal path. Older deposit records may point to a different address or lack real backing; a record alone cannot recover those tokens.</li>
              <li>The custom-token deposit ceiling is 5,000,000 per contract across known network records, not per account. Disconnected peers cannot enforce a simultaneous network-wide reservation.</li>
              <li>This guide describes custom MintMe tokens, not a universal bridge for ETH, BTC, MINTME itself, or external SWARM transfers. Test supported transfers with small amounts.</li>
            </ul>
          </section>
          <footer className="flex flex-wrap gap-3 border-t border-border pt-6">
            <Button asChild variant="outline" size="sm"><Link to="/wallet">Open Wallet<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            <Button asChild variant="link" size="sm"><Link to="/swarm-metamask-guide">SWARM &amp; MetaMask overview</Link></Button>
          </footer>
        </article>
      </main>
    </div>
  );
}