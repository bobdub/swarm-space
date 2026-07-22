import { useNavigate } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Coins,
  Wallet as WalletIcon,
  Link2,
  Shield,
  AlertTriangle,
  Smartphone,
  Monitor,
  Network,
  Sparkles,
} from "lucide-react";
import {
  SWARM_EVM_CHAIN_ID_DEC,
  SWARM_EVM_CHAIN_ID_HEX,
  SWARM_EVM_NETWORK,
} from "@/lib/blockchain/wallets/swarmEvmNetwork";

const Section = ({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-3">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
        <Icon className="w-4 h-4" />
      </div>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
    </div>
    <div className="pl-12 space-y-3 text-sm text-foreground/80 leading-relaxed">
      {children}
    </div>
  </section>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border/30 last:border-0">
    <span className="text-xs uppercase tracking-wide text-foreground/50">{label}</span>
    <code className="text-xs font-mono text-foreground/90 text-right break-all">{value}</code>
  </div>
);

const Callout = ({
  icon: Icon,
  tone = "info",
  title,
  children,
}: {
  icon: React.ElementType;
  tone?: "info" | "warn";
  title: string;
  children: React.ReactNode;
}) => {
  const cls =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
      : "border-primary/20 bg-primary/5 text-foreground/80";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
};

const SwarmMetaMaskGuide = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground">
              SWARM, Creator Tokens & MetaMask
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              What SWARM is, how Creator Tokens work, and how to connect MetaMask
              on desktop or mobile so you can move value in and out of the mesh.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-8 bg-card border-border/40">
          <Section icon={Sparkles} title="What's new">
            <p>
              SWARM now runs a full on-mesh economy. Every account can deploy one{" "}
              <strong>Creator Token</strong> that trades against a{" "}
              <strong>Creator Vault</strong> (40% liquidity/buyback, 40% stability
              floor, 15% creator earnings, 5% community pool).
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Baseline deploy fee:</strong> 25 credits + 5 SWARM
                (dynamic, scales with the community pool).
              </li>
              <li>
                <strong>Supply unlock:</strong> 40% liquid at launch, 60% unlocks
                as you post &amp; earn credits (0.1 token per credit).
              </li>
              <li>
                <strong>Participant listings:</strong> holders can list their own
                tokens for SWARM directly through the Market tab.
              </li>
              <li>
                <strong>Storage safety:</strong> writes are blocked before your
                browser storage fills up; check{" "}
                <button
                  className="underline text-primary"
                  onClick={() => navigate("/storage-diagnostics")}
                >
                  Storage Diagnostics
                </button>{" "}
                for backups and manual token recovery.
              </li>
              <li>
                <strong>Token recovery:</strong> if your local records ever get
                cleared, the app rebuilds your Creator Token from the on-chain
                deploy transaction on next login.
              </li>
            </ul>
          </Section>

          <Section icon={Network} title="The SWARM network at a glance">
            <p>
              SWARM is its own peer-to-peer chain. MetaMask is only used as a{" "}
              <em>bridge</em>: to bring SWARM in, take SWARM out, or interact with
              outside EVM networks (Ethereum, Polygon, BNB, MintMe, etc.). Your
              day-to-day balances, Creator Tokens, credits, and NFTs live inside
              the mesh — no external wallet required to use the app.
            </p>
            <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
              <Row label="Network name" value={SWARM_EVM_NETWORK.chainName} />
              <Row
                label="Chain ID"
                value={`${SWARM_EVM_CHAIN_ID_DEC} (${SWARM_EVM_CHAIN_ID_HEX})`}
              />
              <Row label="Currency" value={`${SWARM_EVM_NETWORK.nativeCurrency.symbol} (18 decimals)`} />
              <Row label="RPC URL" value={SWARM_EVM_NETWORK.rpcUrls[0]} />
              <Row label="Explorer" value={SWARM_EVM_NETWORK.blockExplorerUrls[0]} />
            </div>
          </Section>

          <Section icon={Monitor} title="Connect on desktop">
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Install the MetaMask browser extension from{" "}
                <a
                  className="underline text-primary"
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                >
                  metamask.io/download
                </a>
                . Create or import a wallet.
              </li>
              <li>
                Open <strong>Wallet → Assets</strong> in this app and click{" "}
                <strong>Connect MetaMask</strong>. Approve the popup.
              </li>
              <li>
                Open <strong>Wallet → Bridge</strong> (or the Swarm Gateway panel)
                and click <strong>Add Swarm-Space network</strong>. MetaMask will
                prompt you to add the chain using the details above.
              </li>
              <li>
                Switch MetaMask to <strong>Swarm-Space</strong>. You're now able
                to deposit/withdraw SWARM through the gateway cell.
              </li>
            </ol>
          </Section>

          <Section icon={Smartphone} title="Connect on mobile">
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Install the{" "}
                <a
                  className="underline text-primary"
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                >
                  MetaMask mobile app
                </a>{" "}
                (iOS or Android).
              </li>
              <li>
                In this app, go to <strong>Wallet → Assets</strong> and tap{" "}
                <strong>Connect MetaMask</strong>. A QR code / deep-link prompt
                appears (via the MetaMask SDK).
              </li>
              <li>
                On your phone: either scan the QR from a desktop, or if you're
                already browsing on the phone tap the deep-link to open MetaMask
                and approve the pairing.
              </li>
              <li>
                Back in the app, open <strong>Bridge</strong> and add / switch to
                Swarm-Space just like on desktop.
              </li>
            </ol>
            <Callout icon={Link2} title="Alternative: add the network manually">
              In MetaMask, open <em>Settings → Networks → Add a network manually</em>{" "}
              and paste the Chain ID, RPC URL, currency symbol, and explorer URL
              from the table above.
            </Callout>
          </Section>

          <Section icon={Coins} title="Moving assets in and out">
            <p>
              Assets always flow through your <strong>in-app wallet</strong> first,
              then get used inside the app. The Market is only for trading
              SWARM and Creator Tokens between users — it is not the on/off ramp.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Use assets in the app:</strong> once balances land in
                your in-app wallet, spend them anywhere in Swarm — deploy a
                Creator Token, buy from another creator's market, tip, unlock
                walled posts, or claim land plots. No extra bridging step.
              </li>
              <li>
                <strong>Market (peer-to-peer trades only):</strong>{" "}
                <em>Wallet → Market</em> lets you list mined SWARM or Creator
                Tokens for other users to buy. Proceeds settle back into your
                in-app wallet automatically — today this is the primary way
                bridge currencies (ETH / BTC / MintMe) enter your in-app
                wallet.
              </li>
              <li>
                <strong>SWARM deposits / withdrawals — live:</strong> Wallet →
                Assets → Bridge lets MetaMask send SWARM to your in-app wallet
                and back out to any 0x… address. The in-browser Swarm gateway
                cell translates every MetaMask call — no cloud, no custodian.
              </li>
              <li>
                <strong>MintMe — live (peer bridge):</strong> your MetaMask
                account IS your MintMe vault. The Bridge panel reads your
                on-chain balance and lets you send MintMe peer-to-peer through
                MetaMask. The app never holds MintMe keys.
              </li>
              <li>
                <strong>ETH / BTC — pending bridge signer:</strong> those
                buttons still show "not wired yet" because there is no
                self-custodial peer contract for them yet. Balances only
                reflect P2P market sales for now.
              </li>
              <li>
                <strong>Two vaults, one dashboard:</strong> Wallet → Creator →
                Vaults shows your Creator Vault (SWARM liquidity backing your
                token, 40/40/15/5 split) and your Peer Bridge Vault (your
                MetaMask on MintMe). You can top up the Buyback Reserve from
                your SWARM balance right there.
              </li>
            </ul>
          </Section>

          <Section icon={Shield} title="Risks & notice">
            <Callout icon={AlertTriangle} tone="warn" title="Read this before bridging">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  SWARM is an experimental peer-to-peer chain. Bridge transfers
                  and market listings can fail, stall, or be lost if peers drop
                  offline. Test with small amounts first.
                </li>
                <li>
                  Markets and bridges <strong>require at least one active peer</strong>.
                  If you're offline, trades cannot settle.
                </li>
                <li>
                  MetaMask holds your private keys, not this app. Never share
                  your seed phrase — no one from the project will ever ask.
                </li>
                <li>
                  Your Creator Token, credits, and mesh balances live in this
                  browser's local storage. Use{" "}
                  <button
                    className="underline"
                    onClick={() => navigate("/storage-diagnostics")}
                  >
                    Storage Diagnostics
                  </button>{" "}
                  to export a backup regularly.
                </li>
                <li>
                  Creator Tokens are non-refundable social/creator assets. The
                  stability floor buys back at a minimum, but market price can
                  still fall. Nothing here is financial advice.
                </li>
                <li>
                  Cross-chain gas fees on Ethereum, Polygon, etc. are paid to
                  those networks and are outside our control.
                </li>
              </ul>
            </Callout>
          </Section>

          <Section icon={WalletIcon} title="Quick links">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/wallet")}>
                Open Wallet
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/storage-diagnostics")}
              >
                Storage Diagnostics
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/donate")}>
                Support the project
              </Button>
            </div>
          </Section>
        </Card>
      </div>
    </div>
  );
};

export default SwarmMetaMaskGuide;