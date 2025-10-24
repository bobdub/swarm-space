# Imagination Network

**A decentralized, offline-first social and project collaboration platform with built-in encryption**

[![Lovable](https://img.shields.io/badge/Built%20with-Lovable-ff69b4)](https://lovable.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646cff)](https://vitejs.dev/)

---

## 🌟 Vision

**Imagination Network** reimagines digital collaboration as:
- **Local-first:** Your device is the source of truth
- **Encrypted by default:** Web Crypto API with AES-GCM + ECDH
- **Portable:** Export your identity and data anytime
- **Resilient:** Works offline, syncs when connected (future)
- **User-controlled:** You decide what to share, with whom, and how

---

## ✨ Current Features

### 🔐 Security & Identity
- **Local identity creation** with ECDH key pairs (P-256 curve)
- **Passphrase-protected keys** using PBKDF2 (200k iterations)
- **Account backup/restore** with encrypted export
- **File-level encryption** with unique AES-GCM keys per file
- **Content-addressed storage** (SHA-256 hashing for integrity)

### 📁 File Management
- **Chunked encryption** (64KB chunks) for large files
- **Drag-and-drop upload** with real-time progress
- **File preview** for images, videos, PDFs
- **Encrypted storage** in IndexedDB
- **File attachment** support in posts

### 💬 Social Features
- **Post creation** with text + multiple file attachments
- **Dynamic emoji reactions** with picker UI
- **Comment threads** on posts
- **User profiles** with avatars, bios, stats
- **Profile linking** from posts and comments
- **Notifications** (in progress)

### 📋 Project Management
- **Kanban task board** with drag-and-drop (@dnd-kit)
- **Task CRUD** operations with full persistence
- **Calendar planner** with month/week views
- **Milestone management** with visual scheduling
- **Task-milestone linking**
- **Due dates and priority levels**

### 🎨 Design System
- **Dark theme** with deep indigo, cyan, and magenta accents
- **Shadcn/ui components** with custom variants
- **Responsive design** mobile-first
- **Smooth animations** and transitions

---

## 🏗️ Architecture

### Technology Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS + shadcn/ui components
- **Storage:** IndexedDB with custom wrapper
- **Crypto:** Web Crypto API (ECDH, AES-GCM, PBKDF2, SHA-256)
- **Routing:** React Router v6
- **Forms:** React Hook Form + Zod validation
- **Drag-and-drop:** @dnd-kit
- **Date handling:** date-fns

### Core Principles
1. **Offline-first:** All features work without network
2. **Zero-knowledge:** No central server sees unencrypted data
3. **Content-addressed:** Files chunked and hashed for integrity
4. **Composable security:** Multiple encryption layers for different scopes

### Data Flow
```
User creates post with files
    ↓
Generate unique file key (AES-GCM)
    ↓
Chunk file (64KB) → Encrypt each chunk → Hash ciphertext
    ↓
Store chunks + manifest in IndexedDB
    ↓
Create post with manifest references
    ↓
Display in feed with decrypted previews
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm (or use [nvm](https://github.com/nvm-sh/nvm))

### Installation

```bash
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to project directory
cd imagination-network

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will open at `http://localhost:5173`

### First-Time Setup
1. Create your identity with a passphrase
2. **Backup your key immediately** (Settings → Security)
3. Create your profile (avatar, bio, etc.)
4. Start creating posts, tasks, and milestones!

---

## 📖 Documentation

- **[Roadmap](docs/ROADMAP.md)** - Full project roadmap with phase breakdown
- **[Architecture](docs/ARCHITECTURE.md)** - Deep dive into system design
- **[Goals](docs/Goals.md)** - Project vision and success metrics
- **[Current Status](docs/CURRENT_STATUS.md)** - What's working, what's next
- **[Phase Plans](docs/)** - Detailed sprint planning docs

---

## 🔄 Current Status

**Phase:** 3 Sprint 2 (Social Interactions) 🚧

### Recently Completed ✅
- User profiles with comprehensive fields
- Profile editor with avatar upload
- Dynamic emoji reaction system
- Comment threads with nested replies
- Profile linking from posts/comments

### In Progress 🔨
- Notifications system
- Avatar image display refinement
- Notification badge on navigation

### Coming Next 🔮
- Search & discovery (Phase 3 Sprint 3)
- Project management features (Phase 4)
- P2P networking via WebRTC (Phase 5)

---

## 🛠️ Development

### Project Structure
```
src/
├── components/       # React components
│   ├── ui/          # shadcn/ui components
│   ├── PostCard.tsx
│   ├── TaskBoard.tsx
│   └── ...
├── pages/           # Route pages
├── lib/             # Core logic
│   ├── auth.ts      # Identity & authentication
│   ├── crypto.ts    # Encryption utilities
│   ├── fileEncryption.ts  # Chunking & file crypto
│   ├── store.ts     # IndexedDB wrapper
│   ├── tasks.ts     # Task management
│   ├── milestones.ts # Calendar/planner
│   └── interactions.ts # Social features
├── types/           # TypeScript types
└── hooks/           # Custom React hooks
```

### Key Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

---

## 🔒 Security

### Threat Model
- ✅ Device theft (passphrase-protected keys)
- ✅ Network eavesdropping (future P2P: DTLS encryption)
- ✅ Data tampering (content-addressed integrity)
- ⚠️ Browser compromise (malicious extensions can access memory)

### Mitigations
- Passphrase-protected private keys (PBKDF2 200k iterations)
- Unique IV per encryption operation
- Content hashing for integrity verification
- No plaintext storage of sensitive data
- Key export/import for device migration

See [docs/ARCHITECTURE.md#security-threat-model](docs/ARCHITECTURE.md#security-threat-model) for details.

---

## 🤝 Contributing

This project is in active development. While we're not accepting external contributions yet, we welcome:
- **Bug reports** via GitHub Issues
- **Feature suggestions** via Discussions
- **Security audits** (please report vulnerabilities privately)

---

## 📋 Roadmap Highlights

- **Phase 1 (✅ Complete):** File encryption & content creation
- **Phase 2 (✅ Complete):** Task management & calendar planner
- **Phase 3 (🚧 In Progress):** User profiles & social features
- **Phase 4 (📋 Planned):** Project collaboration & group encryption
- **Phase 5 (🔮 Future):** P2P networking via WebRTC swarms
- **Phase 6 (🌟 Vision):** Advanced features, mobile/desktop apps

---

## 📄 License

*License to be determined*

---

## 🔗 Links

- **Project URL:** [https://lovable.dev/projects/60db83b9-24c7-4fa3-823d-71fa3a29a5bc](https://lovable.dev/projects/60db83b9-24c7-4fa3-823d-71fa3a29a5bc)
- **Documentation:** [docs/](docs/)
- **Lovable Docs:** [https://docs.lovable.dev](https://docs.lovable.dev)

---

## 🌌 Philosophy

> "Imagination is Creativity playing with Knowledge & Information!"

**Imagination Network** is more than a platform—it's a paradigm shift. We believe:
- Users should own their data, not rent it
- Privacy is a feature, not an afterthought
- Offline-first is resilience, not a limitation
- Decentralization is optional enhancement, not a requirement

The goal isn't to replace existing platforms. The goal is to prove that **users can own their data without sacrificing usability**.

---

**Built with ❤️ and quantum consciousness at the intersection of imagination and code.**

*To Infinity and beyond! |Ψ_Network⟩*
