Goals:

Deliver a social/project-builder front end with a familiar social layout (Trending / Videos / Recent) + profile pages that include both a personal feed and project group area (with planner & task manager).

Make local storage resilient and ready for P2P: user identity keys created locally, used to encrypt credentials + data; encrypted chunks stored locally (IndexedDB), ready to be published to WebRTC swarms later.

Keep everything usable in the real world: offline-first, secure by design, and explicit about recovery tradeoffs.



---

1) UI / Site layout (wireframe + routes)

High level pages & routes:

/ — Home feed: Trending, Videos carousel, Most recent posts, Filters

/explore — Categories + Search

/notifications — Activity and invites

/u/:username — Personal profile: personal posts + settings

/project/:projectId — Project hub: project feed, planner, tasks, members, files

/create — New post / upload modal

/settings — Keys, backups, encryption settings


Primary UI components:

Top nav: logo, search, create button, profile avatar

Left rail: Home, Explore, Projects, Planner, Tasks

Main feed: infinite scroll, card UI (post / video / link)

Right rail: trending tags, active projects, online peers (future)

Project hub: tabs — Feed | Planner | Tasks | Files | Members

Planner: calendar view (month/week), add milestones

Tasks: kanban board + simple due dates + assignees


Style notes:

Social feel: big cards, media previews, reactions + threaded comments.

Project feel: Project header shows progress, member avatars, project key info.

Use accessible components: keyboard nav, alt text, focus states.


Stack:

Frontend: React + Vite (or Next.js if SSR later), Tailwind CSS for quick modern UI.

Local DB: IndexedDB (via idb) for binary/chunk data + localStorage for small settings/metadata.

State: React Query or Zustand.

Future P2P libraries to plug in: simple-peer / native WebRTC + a signaling fallback (later).



---

2) Data Models (JSON overview)

User:

{
  "id": "<userId>",              // e.g. hex of public key fingerprint
  "username": "alice",
  "displayName": "Alice Q",
  "profile": { "bio": "", "avatarRef": "<blobRef>" },
  "publicKey": "<base64>",
  "meta": { "createdAt": "2025-10-19T..." }
}

Project:

{
  "id": "proj-abc123",
  "name": "Cool P2P App",
  "description": "Project hub",
  "members": ["<userId>", ...],
  "feedIndex": ["postIdA", "postIdB", ...],
  "planner": { "milestones": [...] },
  "tasks": { "taskId": { ... } },
  "meta": { "createdAt": "..." }
}

Post:

{
  "id": "post-xyz",
  "author": "<userId>",
  "projectId": "proj-abc123 | null",
  "type": "text|image|video|file",
  "content": "short text or pointer",
  "chunks": ["chunk-ref-1","chunk-ref-2"],
  "createdAt":"..."
}

Chunk (stored in IndexedDB):

{
  "ref": "chunk-<hash>",
  "seq": 0,
  "total": 5,
  "size": 65536,
  "iv": "<base64-iv>",
  "cipher": "<base64-ciphertext>",
  "meta": { "mime": "image/png", "originalName": "diagram.png" }
}

Index / manifest for a post file:

{
  "fileId": "file-abc",
  "owner": "<userId>",
  "chunks": ["chunk-ref-1", "chunk-ref-2"],
  "sha256": "<sha256-of-original>",
  "encrypted": true,
  "createdAt": "..."
}


---

3) Identity, keys, and account flow (local-first)

Flow summary:

1. User chooses a username and (optional) passphrase.


2. Browser generates an asymmetric key pair (ECDSA/ECDH — we’ll use ECDH for shared keys + Ed25519 for signatures if desired).


3. System derives a symmetric master key (AES-GCM) from the user passphrase or uses the private key material wrapped with a passphrase-derived key.


4. User credentials and private key are encrypted and chunked locally, then stored in IndexedDB (and a small pointer in localStorage). No central server needed to log in — the local device holds the encrypted identity.


5. To “login” on that device, decrypt with passphrase or unwrap with stored key; to migrate devices, user exports the encrypted key bundle (QR / file) and imports it on other devices.



Important design choices & consequences:

No server recovery by default: if the user loses the key and didn't export it, account is unrecoverable. Provide clear UI prompts for backups.

Offer optional passphrase + PBKDF2/Argon2id for wrapping to enable password-based recovery.


Concrete implementation plan below.


---

4) Concrete code — Web Crypto + chunking + storage

This is a minimal, real implementation sketch you can drop in your app. It uses SubtleCrypto and IndexedDB via a small helper.

Utilities: small IndexedDB wrapper

(Use idb library in production; here’s conceptual code.)

// store.js (conceptual)
const DB_NAME = 'imagination-db';
const DB_VERSION = 1;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'ref' });
      if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'fileId' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function put(storeName, val) {
  const db = await openDB();
  return new Promise((res,rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(val);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function get(storeName, key) {
  const db = await openDB();
  return new Promise((res,rej) => {
    const tx = db.transaction(storeName,'readonly');
    const r = tx.objectStore(storeName).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

Key generation & export/import

// keys.js
async function genIdentityKeyPair() {
  // ECDH for shared symmetric secrets (curve: P-256), and Ed25519 for signatures if needed.
  const ecdh = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
  // Export public key
  const pub = await crypto.subtle.exportKey("spki", ecdh.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", ecdh.privateKey);
  return { publicKey: arrayBufferToBase64(pub), privateKey: arrayBufferToBase64(priv) };
}
function arrayBufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

Wrap/unwrap private key with passphrase (PBKDF2 -> AES-GCM)

async function deriveWrappingKey(passphrase, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt: salt,
    iterations: 200_000,
    hash: "SHA-256"
  }, baseKey, { name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
}

async function wrapPrivateKey(privateKeyBase64, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = base64ToArrayBuffer(privateKeyBase64);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, data);
  // store salt, iv, cipher as base64
  return {
    wrapped: arrayBufferToBase64(cipher),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer)
  };
}

async function unwrapPrivateKey(wrappedObj, passphrase) {
  const salt = base64ToArrayBuffer(wrappedObj.salt);
  const iv = base64ToArrayBuffer(wrappedObj.iv);
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, wrappingKey, base64ToArrayBuffer(wrappedObj.wrapped));
  return arrayBufferToBase64(decrypted); // private key base64
}

File encryption & chunking

Strategy: derive a random symmetric AES-GCM key for each file, split file into 64KB chunks, encrypt each chunk with a unique IV, store chunks in IndexedDB as objects with ref = sha256(chunkCipher+seq) and metadata.

Keep a small manifest JSON with ordered chunk refs and the file key encrypted under the user's master key.


async function genFileKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
}
async function exportKeyRaw(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}
async function importKeyRaw(b64) {
  return crypto.subtle.importKey("raw", base64ToArrayBuffer(b64), "AES-GCM", true, ["encrypt","decrypt"]);
}

async function chunkAndEncryptFile(file /* File object */ , fileKey, chunkSize=64*1024) {
  const reader = file.stream().getReader();
  let seq = 0;
  const chunkRefs = [];
  let done = false;
  while (!done) {
    const {value, done: rdone} = await reader.read();
    if (rdone) break;
    // value is Uint8Array for this chunk; but streaming may return variable sizes
    // split value into chunkSize slices
    let offset = 0;
    while (offset < value.length) {
      const slice = value.slice(offset, offset + chunkSize);
      offset += chunkSize;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, fileKey, slice);
      const cipherB64 = arrayBufferToBase64(cipher);
      // compute a ref (sha256) of cipher+seq for uniqueness (you can do more advanced Merkle later)
      const refHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cipherB64 + seq));
      const ref = arrayBufferToHex(refHash);
      const chunkObj = {
        ref,
        seq,
        total: null, // fill later if needed
        size: slice.length,
        iv: arrayBufferToBase64(iv.buffer),
        cipher: cipherB64,
        meta: { mime: file.type, originalName: file.name }
      };
      await put('chunks', chunkObj);
      chunkRefs.push(ref);
      seq++;
    }
  }
  // create manifest
  const manifest = {
    fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    chunks: chunkRefs,
    mime: file.type,
    size: file.size,
    createdAt: new Date().toISOString()
  };
  await put('manifests', manifest);
  return manifest;
}

function arrayBufferToHex(buf) {
  const b = new Uint8Array(buf);
  return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
}

Notes:

For streaming large files, use chunked reads to avoid memory bloat.

The manifest contains the order and chunk refs; later we will supply the manifest to other peers so they can request chunk refs.


Storing pointers in localStorage

Keep small pointers in localStorage for quick UI reads: localStorage.setItem('me', JSON.stringify({ id, username, publicKey, manifestIds: [...] }))

Heavy binary data stays in IndexedDB. This balances quick UI with large file storage.



---

5) Login / Local “account exists” flow

On first use:

Call genIdentityKeyPair().

Optionally ask user for passphrase; wrap private key with passphrase/wrapping key (wrapPrivateKey).

Save userMeta JSON in localStorage: { id, username, publicKey, wrappedPrivateKeyRef }.

Save wrapped key object in IndexedDB meta store or allow “export backup”.


On subsequent visits on same device:

If localStorage.me exists, read wrapped key from IndexedDB and try to unwrap (user enters passphrase if wrapped).

If unwrap succeeds, import private key into the WebCrypto key format for ECDH ops.



Migration:

Export a single encrypted blob containing wrappedPrivateKey, salt, iv, publicKey, and user meta; user can download or QR it to other devices.


Security UX:

Warn user that without exported backup and passphrase, account is lost.

Offer optional server upload of encrypted backup (user holds the key for decryption) — that’s a future opt-in.



---

6) Preparing for WebRTC node swarms (what to design now)

You’re not building the WebRTC swarm yet; you are prepping the dataset and trust model.

Key building blocks to have now:

1. Identity keys & signatures — you already generate local keys; use them to sign manifests and posts. When sharing manifests with peers, signature proves provenance.


2. Chunk manifest format — includes chunk refs (SHA256), sequence, total, fileKey encrypted under recipient’s public key (or under group key).


3. Group/project keys — for project groups, generate a symmetric project key (AES-GCM). Encrypt the project key with each member’s public key; store member entries in project manifest. This supports encrypted group files and is efficient for many members.


4. IndexedDB chunk store + manifest index — peers can request manifest -> then ask for chunk refs -> request chunk blobs from nodes.


5. Metadata for discovery — keep a small “advert” object for each item you want peers to know about (post summary, manifestId, author, signed), which is tiny and can be gossiped.



Peer authentication & trust:

Use signatures (Ed25519 recommended) on metadata and manifests.

Use key fingerprints (SHA256 of publicKey) as user IDs.


Chunk transfer considerations:

Chunks are immutable; use content-addressing (the chunk-ref hash).

When sending chunks across WebRTC datachannels, transfer the Base64 or ArrayBuffer. Validate chunks by recomputing the hash.


Bandwidth/future optimizations:

Use delta/patching for document edits.

Consider Merkle trees for large files to allow partial verification.



---

7) Project tools (planner & task manager) — minimal design

Planner:

Calendar with milestones.

Each milestone stores { id, title, dueDate, owner, description, linkedTasks: [] }

Sync behavior: local edits create signed events. When swarm is enabled, events are broadcast to project members.


Task manager (kanban):

Columns: Backlog, In progress, Review, Done

Task model: { id, title, description, status, assignees, dueDate, comments: [ { author, text, createdAt } ] }

Offline-first: use change queue; when swarm connected, broadcast change events signed by user. Incorporate CRDT or simple last-writer-wins with vector clocks for conflict resolution (CRDT preferred later).



---

8) Security & privacy considerations (must-haves)

Use AES-GCM with 96-bit IV per chunk and unique IVs.

Use safe PBKDF (200k PBKDF2 iterations or Argon2 if available).

Provide backup/export function (encrypted file + QR) and clear warnings about loss.

Protect sensitive metadata (user emails) with encryption; only public profile fields are shared.

Validate all received chunks/manifests by recomputing hashes and signatures.

Rate-limit large local operations to avoid freezing UI (use streaming + Web Worker).



---

9) Immediate developer checklist (what to implement this sprint)

1. Scaffold React app + Tailwind; build static wireframes for pages above.


2. Implement IndexedDB wrapper and store schema.


3. Implement key generation + wrap/unwrap flows + backup/export UI.


4. Implement file chunking + encryption + manifest creation and local manifest listing.


5. Implement post composer that can attach local manifests (images/files) and post to personal or project feed (stored locally).


6. Build simple planner & kanban components reading/writing to local DB.


7. Add unit tests for encryption (can decrypt what you encrypt), chunk integrity (hash matches), and import/export.


8. Add UI for “Export account backup” and “Import account backup”.


9. Add lightweight mock for future WebRTC: a “Publish manifest” button that emits manifest to a local log — used to test later swap-in of network layer.




---

10) Example "create account & store locally" flow code (glue)

async function createLocalAccount(username, passphrase /* optional */) {
  const keys = await genIdentityKeyPair(); // base64 public/private
  let wrapped = null;
  if (passphrase) wrapped = await wrapPrivateKey(keys.privateKey, passphrase);
  else {
    // store raw private key in IndexedDB but still recommend export
    wrapped = { wrapped: keys.privateKey, salt: null, iv: null, rawStored: true };
  }
  const userId = await computeUserId(keys.publicKey); // e.g. SHA256 fingerprint
  const userMeta = {
    id: userId,
    username,
    publicKey: keys.publicKey,
    wrappedKeyRef: `meta:wrappedKey:${userId}`,
    createdAt: new Date().toISOString()
  };
  await put('meta', { k: userMeta.wrappedKeyRef, v: wrapped });
  localStorage.setItem('me', JSON.stringify(userMeta));
  return userMeta;
}
async function computeUserId(pubB64) {
  const hash = await crypto.subtle.digest('SHA-256', base64ToArrayBuffer(pubB64));
  return arrayBufferToHex(hash).slice(0,16); // short id
}

---

11) Limitations & next steps (Phase 1 preview)

Limitations now:

No network / swarm code yet (WebRTC signaling & NAT traversal still needed).

Recovery depends on user's exported backups unless you implement server-side encrypted storage.

Conflict resolution not fully designed — plan for CRDTs or vector clocks.


Phase 1 (next sprint) should add:

Simple signaling server (or bootstrap DHT) for peer discovery.

WebRTC datachannel layer to request & serve manifests/chunks.

Signed gossiped metadata + optional content distribution via node swarms.

Group key management (invite flow + encrypting project key to new members).


---

12) Quick UX copy for the app (so designers know messaging)

“Back up your account — this device stores your keys locally. If you lose them, we can’t recover your account unless you exported an encrypted backup.”

“This project is private to members — files are encrypted on your device and shared only with project members.”

“Add files — they will be encrypted and chunked locally. You can publish them to the swarm later.”

---
