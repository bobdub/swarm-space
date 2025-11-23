# MetaMask & Web3 Wallet Integration Plan

## Overview
Integrate MetaMask and other Web3 wallets (WalletConnect, Coinbase Wallet) to enable users to connect external wallets, view SWARM tokens in MetaMask, and interact with the SWARM blockchain using familiar Web3 tools.

## Core Features

### 1. Wallet Connection

#### Supported Wallets
- **MetaMask** (Primary)
  - Browser extension
  - Mobile app via deep links
  - Snap support (future)

- **WalletConnect v2**
  - 300+ wallet support
  - Mobile wallet connection
  - QR code scanning

- **Coinbase Wallet**
  - Native integration
  - Smart Wallet support
  - Mobile app connection

- **Trust Wallet**
- **Rainbow Wallet**
- **Ledger** (Hardware wallet)

#### Connection Flow
1. **Connect Button** - Click "Connect Wallet"
2. **Wallet Selection** - Choose wallet provider
3. **Approval** - User approves connection in wallet
4. **Chain Detection** - Auto-detect connected chain
5. **Address Import** - Import wallet address as profile identity
6. **Success** - Display connected status

### 2. SWARM Network Configuration

#### Add SWARM Network to MetaMask
```javascript
const SWARM_NETWORK = {
  chainId: '0x1337', // 4919 in hex (custom chain ID)
  chainName: 'SWARM Network',
  nativeCurrency: {
    name: 'SWARM',
    symbol: 'SWRM',
    decimals: 18
  },
  rpcUrls: ['https://rpc.swarm.network'], // P2P RPC endpoint
  blockExplorerUrls: ['https://explorer.swarm.network']
};

// Auto-add network when user connects
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [SWARM_NETWORK]
});
```

#### Custom RPC Provider
- **P2P RPC Node**
  - Expose JSON-RPC compatible API
  - eth_getBalance, eth_sendTransaction, etc.
  - Translate to IndexedDB operations
  - Sign transactions with user's key

- **RPC Methods Supported**
  - `eth_accounts` - Get connected accounts
  - `eth_chainId` - Return SWARM chain ID
  - `eth_getBalance` - Get SWARM balance
  - `eth_sendTransaction` - Send SWARM tokens
  - `eth_sign` - Sign messages
  - `personal_sign` - Personal signatures
  - `eth_getTransactionReceipt` - Get tx status

### 3. Token Display in MetaMask

#### Add SWARM Token
```javascript
const SWARM_TOKEN = {
  type: 'ERC20', // Standard interface
  options: {
    address: '0xSwarmTokenContract', // SWARM native token address
    symbol: 'SWRM',
    decimals: 18,
    image: 'https://swarm.network/logo.png'
  }
};

// Auto-suggest token addition
await window.ethereum.request({
  method: 'wallet_watchAsset',
  params: SWARM_TOKEN
});
```

#### Profile Token Display
- **Dynamic Token Addition**
  - When user deploys profile token
  - Auto-suggest adding to MetaMask
  - Custom token icon (creator's avatar)
  - Display in token list

```javascript
await window.ethereum.request({
  method: 'wallet_watchAsset',
  params: {
    type: 'ERC20',
    options: {
      address: profileToken.contractAddress,
      symbol: profileToken.ticker,
      decimals: 0, // Profile tokens are whole numbers
      image: profileToken.image
    }
  }
});
```

### 4. Transaction Signing

#### Sign Transactions with MetaMask
```typescript
async function sendSWARM(to: string, amount: number) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  
  const tx = {
    to,
    value: ethers.utils.parseEther(amount.toString()),
    gasLimit: 21000,
    gasPrice: ethers.utils.parseUnits('1', 'gwei')
  };
  
  const txResponse = await signer.sendTransaction(tx);
  await txResponse.wait();
  
  return txResponse.hash;
}
```

#### Sign Messages for Authentication
```typescript
async function authenticateWithMetaMask() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const address = await signer.getAddress();
  
  const message = `Sign this message to authenticate with SWARM: ${Date.now()}`;
  const signature = await signer.signMessage(message);
  
  // Verify signature server-side
  const verified = ethers.utils.verifyMessage(message, signature) === address;
  
  return { address, signature, verified };
}
```

### 5. Account Management

#### Multi-Account Support
- **Switch Accounts**
  - Detect MetaMask account changes
  - Update UI with new account
  - Sync profile data

```typescript
window.ethereum.on('accountsChanged', async (accounts) => {
  if (accounts.length === 0) {
    // User disconnected
    handleDisconnect();
  } else {
    // User switched account
    const newAddress = accounts[0];
    await loadProfile(newAddress);
  }
});
```

#### Chain Switching
```typescript
window.ethereum.on('chainChanged', (chainId) => {
  if (chainId !== '0x1337') {
    // User switched away from SWARM
    showWarning('Please switch back to SWARM Network');
  }
});
```

### 6. Balance & Portfolio Display

#### Real-Time Balance Sync
- **MetaMask Balance** ↔ **SWARM Balance**
  - Two-way sync
  - Update MetaMask when earning credits
  - Update SWARM when receiving external transfers
  - Periodic reconciliation (every 30s)

#### Portfolio View in Wallet
- **Assets Tab**
  - SWARM balance
  - Profile tokens owned
  - NFTs held
  - Total portfolio value (USD)

- **Activity Tab**
  - Recent transactions
  - Filter by type (send, receive, swap)
  - Export transaction history

### 7. NFT Display in MetaMask

#### ERC-721 Compatibility
```typescript
interface IERC721Metadata {
  name(): string;
  symbol(): string;
  tokenURI(tokenId: uint256): string;
}

// Serve NFT metadata
app.get('/nft/:tokenId/metadata', (req, res) => {
  const nft = getNFTById(req.params.tokenId);
  
  res.json({
    name: nft.name,
    description: nft.description,
    image: nft.image,
    attributes: [
      { trait_type: 'Creator', value: nft.creator },
      { trait_type: 'Rarity', value: nft.rarity },
      { trait_type: 'Locked Tokens', value: nft.lockedTokens }
    ]
  });
});
```

#### Auto-Display NFTs
- When user mints NFT, auto-show in MetaMask
- Support for OpenSea metadata standard
- High-quality image thumbnails

## Technical Architecture

### Web3 Provider Integration

#### Custom Provider Class
```typescript
class SwarmProvider extends ethers.providers.BaseProvider {
  async getBalance(address: string): Promise<BigNumber> {
    const balance = await getCreditBalance(address);
    return ethers.utils.parseEther(balance.toString());
  }
  
  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    // Translate to SWARM transaction
    const swarmTx = await createSwarmTransaction(tx);
    await broadcastTransaction(swarmTx);
    return swarmTx;
  }
  
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt> {
    const tx = await getSwarmTransaction(txHash);
    return {
      transactionHash: txHash,
      blockNumber: tx.blockNumber,
      status: tx.status === 'confirmed' ? 1 : 0,
      from: tx.from,
      to: tx.to
    };
  }
}
```

#### WalletConnect Integration
```typescript
import { EthereumProvider } from '@walletconnect/ethereum-provider';

const provider = await EthereumProvider.init({
  projectId: 'swarm-project-id',
  chains: [4919], // SWARM chain ID
  showQrModal: true,
  methods: [
    'eth_sendTransaction',
    'personal_sign',
    'eth_sign'
  ],
  events: ['chainChanged', 'accountsChanged'],
  rpcMap: {
    4919: 'https://rpc.swarm.network'
  }
});

await provider.connect();
```

### Smart Contract Interactions

#### Token Contract Interface
```solidity
// SWARM ERC20 Token Contract
contract SWARMToken is ERC20 {
  constructor() ERC20("SWARM", "SWRM") {
    _mint(msg.sender, 1000000000 * 10 ** decimals()); // 1B initial supply
  }
  
  function mint(address to, uint256 amount) external onlyMinter {
    _mint(to, amount);
  }
  
  function burn(uint256 amount) external {
    _burn(msg.sender, amount);
  }
}
```

#### Profile Token Factory
```solidity
contract ProfileTokenFactory {
  mapping(address => address) public profileTokens;
  
  event ProfileTokenDeployed(
    address indexed creator,
    address indexed tokenAddress,
    string ticker,
    uint256 initialSupply
  );
  
  function deployProfileToken(
    string memory name,
    string memory ticker,
    uint256 initialSupply
  ) external returns (address) {
    ProfileToken token = new ProfileToken(name, ticker, initialSupply, msg.sender);
    profileTokens[msg.sender] = address(token);
    
    emit ProfileTokenDeployed(msg.sender, address(token), ticker, initialSupply);
    return address(token);
  }
}
```

### Security Considerations

#### Permission Management
- Request minimal permissions from wallet
- Never request private keys
- Sign messages, not transactions, when possible
- Clear permission explanations

#### Phishing Protection
- Verify wallet domain (metamask.io)
- Display transaction details clearly
- Warning for unusual transactions
- Educate users on wallet security

#### Secure Storage
- Never store private keys
- Use wallet's built-in encryption
- Session-based authentication
- Auto-logout after inactivity

## User Experience

### Onboarding Flow
1. **Welcome Screen** - "Connect your wallet"
2. **Wallet Selection** - Icons for MetaMask, WalletConnect, etc.
3. **Installation Check** - Detect if MetaMask installed
4. **Connection** - User approves in wallet popup
5. **Network Setup** - Auto-add SWARM network
6. **Profile Creation** - Link wallet to SWARM profile
7. **Success** - Dashboard with balance

### UI Components

#### Wallet Button
```tsx
<Button onClick={connectWallet}>
  {isConnected ? (
    <div className="flex items-center gap-2">
      <Avatar address={walletAddress} size="sm" />
      <span>{formatAddress(walletAddress)}</span>
      <Badge variant="success">Connected</Badge>
    </div>
  ) : (
    <>
      <WalletIcon />
      Connect Wallet
    </>
  )}
</Button>
```

#### Network Indicator
```tsx
{chainId !== SWARM_CHAIN_ID && (
  <Alert variant="warning">
    <AlertCircle />
    <AlertDescription>
      Please switch to SWARM Network in your wallet.
      <Button onClick={switchToSwarm}>Switch Network</Button>
    </AlertDescription>
  </Alert>
)}
```

### Mobile Experience
- Deep link to MetaMask mobile app
- QR code for WalletConnect
- Responsive wallet selector
- Mobile-optimized transaction confirmations

## Integration Timeline

### Phase 1: Basic Connection (Week 1-2)
- MetaMask connection
- Account detection
- Sign messages for auth
- Display wallet address

### Phase 2: Network Setup (Week 3-4)
- Add SWARM network to MetaMask
- Custom RPC provider
- Basic transaction support
- Chain/account change detection

### Phase 3: Token Display (Week 5-6)
- Add SWARM token to MetaMask
- Profile token addition
- Balance synchronization
- Transaction history

### Phase 4: Advanced Features (Week 7-8)
- WalletConnect integration
- NFT display
- Multi-wallet support
- Hardware wallet support

## Success Metrics
- 50% of users connect external wallet
- 1,000+ MetaMask SWARM token additions
- <3 second wallet connection time
- 99% successful transaction signing
- 24/7 RPC uptime

## Future Enhancements

### MetaMask Snaps
- Custom SWARM Snap
- Transaction insights
- Notification system
- Enhanced security warnings

### Mobile Wallets
- Dedicated mobile wallet app
- Biometric authentication
- Push notifications
- QR code scanning

### Advanced Features
- ENS integration (yourname.swarm)
- Wallet recovery system
- Multi-sig wallets
- Social recovery

### DApp Browser
- In-wallet DApp browsing
- Pre-approved transactions
- Session management
- Bookmark favorite DApps
