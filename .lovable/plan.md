

## Fix: Recovery Key Generation Fails During Signup

### Root Cause

In `SignupWizard.tsx` line 272-273, `generateRecoveryKey(password, tempId, recoveryPhrase)` is called **before account creation**. The function (line 166-177 of `recoveryKey.ts`) calls `getCurrentUser()` which returns `null` because no account exists yet, throwing `"No active user to back up"`.

### Fix Strategy

Split into two phases:
1. **During signup** — generate only the recovery key string (the lookup address). No identity payload needed yet.
2. **After account creation** — generate the full backup (chunks + manifest) using the real user data.

### Changes

**`src/lib/backup/recoveryKey.ts`** — Add a lightweight `generateRecoveryKeyOnly()` function:
- Takes no identity payload
- Generates the salt, computes userIdHashPrefix, returns `{ recoveryKey, salt }` only
- No encryption, no chunks — just the human-readable SWRM key

**`src/components/onboarding/SignupWizard.tsx`**:
- **Step 3 (backup)**: Call `generateRecoveryKeyOnly(userId)` instead of `generateRecoveryKey(...)`. This always succeeds because it doesn't need an existing account.
- **After account creation** (line 207-225): Call full `generateRecoveryKey(password, user.id, recoveryPhrase, identityPayload)` to produce chunks. Store chunks and mark backup done.
- Store the salt from step 3 so the full backup in step 4 uses the same salt (same recovery key).

**`src/lib/backup/recoveryKey.ts`** — Update `generateRecoveryKey` to accept an optional `salt` parameter:
- If provided, reuse it (so the key matches what was shown to user)
- If not, generate fresh (backward compatible for migration panel)

### Technical Detail

```text
CURRENT (broken):
  Signup Step 3 → generateRecoveryKey(pwd, tempId, phrase)
    → getCurrentUser() → null → THROW ❌

FIXED:
  Signup Step 3 → generateRecoveryKeyOnly(tempId)
    → returns { recoveryKey: "SWRM-...", salt } ✅ (no crypto payload needed)
  
  Signup Step 5 (after createLocalAccount) →
    generateRecoveryKey(pwd, user.id, phrase, null, salt)
    → getCurrentUser() → real user → encrypts + chunks ✅
```

### Files Changed

| File | Change |
|------|--------|
| `src/lib/backup/recoveryKey.ts` | Add `generateRecoveryKeyOnly()`; add optional `salt` param to `generateRecoveryKey` |
| `src/components/onboarding/SignupWizard.tsx` | Use `generateRecoveryKeyOnly` in step 3; move full backup to post-creation |

