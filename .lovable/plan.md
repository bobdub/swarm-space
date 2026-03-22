

# Merge Cookie Consent into TOS Step with Dual Checkboxes

## Summary
Reduce the wizard from 4 steps to 3 by removing the need for a separate cookie/storage consent. The TOS step gains two required checkboxes that the user must tick (after scrolling) before the "Accept & Create Account" button enables. This also lets us remove the standalone `CookieConsentBanner` from `App.tsx`.

## Changes

### 1. Add two checkboxes to the TOS step
**File: `src/components/onboarding/SignupWizard.tsx`**
- Add two boolean state variables: `tosChecked` and `storageChecked`
- Reset both in the `useEffect` on close
- Below the TOS scroll container, render two `Checkbox` + label pairs:
  1. "I have read and understand the Terms of Service"
  2. "I accept cookies and the application to manage local data, persistent calls required to use this application"
- Both checkboxes are only enabled after the user has scrolled to the bottom of the TOS
- The "Accept & Create Account" button requires `scrolledTos && tosChecked && storageChecked`

### 2. Grant storage consent on account creation
**File: `src/components/onboarding/SignupWizard.tsx`**
- In `handleCreate`, write `localStorage.setItem("flux_storage_consent", "granted")` and dispatch `storage-consent-granted` event — same as what the old banner did

### 3. Remove standalone CookieConsentBanner from App
**File: `src/App.tsx`**
- Remove the `<CookieConsentBanner />` component render
- Keep the `hasStorageConsent()` export in `CookieConsentBanner.tsx` as a utility

### 4. Add passphrase download hint to backup step
**File: `src/components/onboarding/SignupWizard.tsx`**
- Below the strength meter in step 3, add a small info line: "You can download this passphrase as a .txt file after account creation in Settings → Keys & Backup."

## Technical Details
- Uses the existing `Checkbox` component from `@/components/ui/checkbox`
- No step count changes needed in `STEPS` array — stays at 4 steps: credentials, network, backup, tos
- The button disabled condition changes from `!scrolledTos` to `!scrolledTos || !tosChecked || !storageChecked`

