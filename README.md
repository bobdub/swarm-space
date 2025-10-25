# Imagination Network

A **decentralized, offline-first** social and collaboration platform built with React, TypeScript, and WebRTC.

## 🌟 Features

- **Offline-First**: Full functionality without internet - all data stored locally via IndexedDB
- **Zero-Knowledge Encryption**: Files chunked and encrypted client-side with AES-GCM
- **P2P Content Sharing**: Direct peer-to-peer file distribution using WebRTC + PeerJS
- **Credits System**: Earn and spend credits for posts, reactions, and peer transfers
- **Project Management**: Kanban boards, tasks, milestones, and planning tools
- **Social Features**: Posts, comments, reactions, notifications, and user profiles

---

## 🌐 P2P Networking with PeerJS

### How It Works

The Imagination Network uses **PeerJS** for zero-config peer-to-peer connections:

1. **Signaling**: PeerJS cloud infrastructure handles initial peer discovery (zero config)
2. **WebRTC**: Direct browser-to-browser connections for data transfer
3. **Encryption**: All file chunks are already encrypted before P2P transfer
4. **Content-Addressed**: Files identified by cryptographic hash (SHA-256)

### External Dependency: PeerJS Cloud

**Important**: This app uses PeerJS's free cloud-hosted signaling server for initial peer discovery.

- **Service**: [PeerJS Cloud](https://peerjs.com/)
- **Purpose**: WebRTC signaling and NAT traversal only
- **Data Flow**: Once peers connect, **all content flows directly P2P** (not through PeerJS servers)
- **Privacy**: PeerJS servers only see connection metadata, never your encrypted content

**Why PeerJS?**
- ✅ Zero configuration required (works out of the box)
- ✅ Cross-device peer discovery (phone ↔ desktop ↔ tablet)
- ✅ Automatic NAT traversal (STUN/TURN)
- ✅ Reliable and maintained infrastructure
- ✅ Free tier sufficient for most use cases

**Alternative**: For fully self-hosted deployment, you can run your own [PeerJS server](https://github.com/peers/peerjs-server) and configure the client accordingly.

### Using P2P

1. **Enable P2P**: Click the Wi-Fi icon in the top navigation
2. **Get Your Peer ID**: Displayed in the P2P status popover  
3. **Connect to Peers**: Share your Peer ID or enter a friend's ID to connect
4. **Share Content**: Once connected, peers automatically discover and share available files

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or Bun
- Modern browser (Chrome, Firefox, Edge, Safari)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/imagination-network.git
cd imagination-network

# Install dependencies
npm install
# or
bun install

# Start development server
npm run dev
# or
bun dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### First-Time Setup
1. Create your identity with a passphrase
2. **Backup your key immediately** (Settings → Security)
3. Create your profile (avatar, bio, etc.)
4. Enable P2P to start connecting with peers!

---

## 🔐 Security & Privacy

### Encryption Layers

1. **Identity Keys** (ECDH P-256)
   - User identity derived from public key
   - Private key encrypted with passphrase (PBKDF2 + AES-GCM)

2. **File Encryption** (AES-GCM 256-bit)
   - Files split into 64KB chunks
   - Each chunk encrypted with unique IV
   - Content-addressed by SHA-256 hash

3. **P2P Security**
   - Chunks transferred encrypted (never decrypted in transit)
   - Hash validation on receipt
   - Peer authentication via user IDs

### Data Storage

- **Local Only**: All data stored in browser IndexedDB
- **No Backend**: No central servers (except PeerJS signaling)
- **Your Control**: Export/backup your encrypted data anytime

### Threat Model

- ✅ **Device theft**: Passphrase-protected keys
- ✅ **Network eavesdropping**: End-to-end encrypted P2P
- ✅ **Data tampering**: Content-addressed integrity verification
- ⚠️ **Browser compromise**: Malicious extensions can access memory
- ⚠️ **Signaling metadata**: PeerJS sees connection metadata (not content)

---

## 📁 Project Structure

```
src/
├── components/       # React UI components
├── hooks/           # Custom React hooks
├── lib/
│   ├── auth.ts      # User authentication
│   ├── credits.ts   # Credits system
│   ├── crypto.ts    # Encryption utilities
│   ├── fileEncryption.ts  # File chunking & encryption
│   ├── store.ts     # IndexedDB wrapper
│   └── p2p/         # P2P networking
│       ├── manager.ts        # Main P2P orchestrator
│       ├── peerjs-adapter.ts # PeerJS integration
│       ├── discovery.ts      # Peer discovery
│       ├── chunkProtocol.ts  # File chunk transfer
│       └── postSync.ts       # Post synchronization
├── pages/           # Page components
└── types/           # TypeScript type definitions
```

---

## 🛠️ Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui
- **Storage**: IndexedDB (custom wrapper)
- **Crypto**: Web Crypto API (AES-GCM, ECDH, SHA-256, PBKDF2)
- **P2P**: PeerJS (WebRTC signaling), WebRTC Data Channels
- **Routing**: React Router v6

---

## 📚 Documentation

- **Architecture**: `docs/ARCHITECTURE.md` - System design and encryption details
- **Roadmap**: `docs/ROADMAP.md` - Development phases and plans
- **Stable Node Quickstart**: `docs/Stable-Node.md` - Keep a laptop online as an authentication anchor
- **Wireframes**: `docs/WIREFRAME_OVERVIEW.md` - UI/UX specifications
- **Current Status**: `docs/CURRENT_STATUS.md` - Implementation status
- **Credits**: `docs/Credits-Whitepaper.md` - Credits system design

---

## 🧪 Testing P2P

### Local Testing (Single Device)
1. Open multiple browser tabs with the app
2. Enable P2P in each tab
3. Watch peers discover each other via P2P status indicator
4. Share content between tabs

### Cross-Device Testing
1. Deploy the app or use local network URL
2. Open on different devices (phone, tablet, desktop)
3. Enable P2P on all devices
4. Peers will discover each other via PeerJS cloud signaling
5. Share Peer IDs to establish connections

---

## 🚢 Deployment

### Static Hosting (Recommended)

The app is a static single-page application (SPA):

```bash
# Build for production
npm run build

# Deploy the dist/ folder to:
# - Netlify
# - Vercel
# - GitHub Pages
# - CloudFlare Pages
# - Any static host
```

### Important Notes

- **No Backend Required**: The app runs entirely in the browser
- **HTTPS Required**: WebRTC requires HTTPS in production (localhost works without)
- **PeerJS Dependency**: Requires internet connection for initial peer discovery
- **CORS**: No special CORS configuration needed for static hosting

---

## ⚠️ Known Limitations

1. **Single Device Sync**: No automatic sync between your own devices (yet)
2. **Data Loss Risk**: No automatic backups - export your account regularly
3. **Browser Storage**: Limited by browser quota (typically 50MB - unlimited depending on browser)
4. **PeerJS Dependency**: Initial peer discovery requires internet connection to PeerJS cloud
5. **NAT Traversal**: Some restrictive corporate networks may block P2P connections
6. **Mobile Performance**: Large file transfers may be slower on mobile devices

---

## 🔄 Current Status

**Phase:** 6.1 Complete ✅ | Next: P2P Stabilization + Phase 6.2

### Recently Completed ✅
- **PeerJS Integration**: Zero-config cross-device P2P discovery
- Credits system foundation (100% complete)
- Automatic account setup with onboarding
- Persistent login and P2P preferences
- Mobile-responsive unified navigation

### In Progress 🔨
- P2P testing and stabilization
- Cross-device connectivity validation
- Performance optimization

### Coming Next 🔮
- Enhanced credit features (tipping, leaderboards)
- Post synchronization via P2P
- File chunk distribution testing

---

## 🤝 Contributing

This project is in active development. We welcome:
- **Bug reports** via GitHub Issues
- **Feature suggestions** via Discussions  
- **Security audits** (please report vulnerabilities privately)

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **PeerJS** - Simple, robust WebRTC peer-to-peer networking
- **shadcn/ui** - Beautiful, accessible component library
- **Web Crypto API** - Browser-native encryption primitives
- **Lovable** - AI-powered development platform

---

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

**Remember**: Your data is yours. Export backups regularly and keep your passphrase safe!

**Built with ❤️ at the intersection of privacy, decentralization, and usability.**

*To Infinity and beyond! |Ψ_Network⟩*
