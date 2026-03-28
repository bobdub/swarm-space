

## Hardened Recovery Key System — Lookup Tag + Password Decryption

The key stored on the mesh is **only a lookup address** (HMAC-derived tag). The actual identity payload remains AES-256-GCM encrypted and requires the user's password to decrypt. The recovery key alone reveals nothing.

---

### How It Works

```text
BACKUP (at signup):
  identity payload + password + userId
       ↓
  encKey = PBKDF2(password + userId, 250k iter)
  tagKey = HMAC(userId + random_salt)
       ↓
  Encrypt payload with encKey → ciphertext chunks
  Tag chunks with tagKey → distribute to mesh
       ↓
  Recovery Key = "SWRM-{salt-encoded}-{tag-prefix}"
  (This is just a LOOKUP ADDRESS — no encrypted data)
       ↓
  User downloads key as .txt or copies it

RECOVERY (new device):
  User enters: Recovery Key + Account Password
       ↓
  Parse key → extract salt → recompute tagKey
  Query mesh for chunks matching tags
       ↓
  Derive encKey from password + userId (userId from chunk metadata)
  Decrypt chunks → restore identity
  If decryption fails → access denied (wrong password)
```

**Security**: Even if an attacker intercepts every chunk on the mesh, they get AES-256-GCM ciphertext. The key is a locker number; the password is the combination.

---

### Changes

**1. `src/lib/backup/recoveryKey.ts`** — Create

- `generateRecoveryKey(password, userId, identityPayload)`:
  - Generate random 16-byte salt
  - Derive `tagKey` via `HMAC-SHA256(userId + salt)` for mesh chunk lookup
  - Derive `encKey` via `PBKDF2(password + userId, 250k iter)` for AES-256-GCM encryption
  - Encrypt identity, chunk it, tag chunks with HMAC(tagKey, index)
  - Encode salt + tag-prefix as human-readable key: `SWRM-XXXX-XXXX-XXXX` (base32, ~40 chars)
  - The key contains NO encrypted data — only the salt and a truncated userId hash
- `recoverFromKey(recoveryKey, password)`:
  - Parse key → extract salt → recompute tagKey → return tags for mesh query
  - After chunks retrieved: derive encKey from password, decrypt, return identity
- Max key length: 64 characters (just a lookup tag, not data)

**2. `src/lib/backup/passphraseBackup.ts`** — Modify

- Add `createRecoveryKeyBackup(password, userId)` wrapper that calls `generateRecoveryKey` and returns mesh-compatible `BackupChunk[]`
- Keep all existing passphrase functions for legacy compatibility

**3. `src/components/onboarding/SignupWizard.tsx`** — Modify

- Replace Step 3 backup textarea with a "Recovery Key" card:
  - Auto-generates key on step entry using password from Step 1
  - Displays key in a styled read-only card (`SWRM-XXXX-XXXX-...`)
  - Copy + Download buttons
  - Checkbox: "I've saved my recovery key" required to proceed
  - Remove 200-char textarea and entropy meter

**4. `src/components/AccountRecoveryPanel.tsx`** — Modify

- Add "Recover with Key" tab: two fields (Recovery Key + Password)
- On submit: parse key → query mesh → decrypt with password → restore
- Legacy passphrase tab remains for existing accounts

**5. `src/components/p2p/settings/IdentityRecoveryPanel.tsx`** — Modify

- Show which backup method the account uses (key vs legacy passphrase)
- Re-download recovery key button for key-based accounts

---

### Key Details

- **Recovery key is NOT the encrypted data** — it's a 40-64 char lookup address derived from `HMAC(userId + salt)`
- **Mesh stores only ciphertext** — tagged chunks that require `PBKDF2(password + userId)` to decrypt
- **Intercepting the key is useless** without the password — attacker can find the chunks but cannot decrypt them
- **Backward compatible** — existing 200-char passphrase accounts continue working unchanged
- **Base32 encoding** (A-Z, 2-7) — no ambiguous characters (0/O, 1/I)

