# Manual QA: Brave onboarding storage messaging

## Goal
Confirm that the onboarding storage warning only shows Brave-specific remediation when the browser is detected as Brave and storage checks fail.

## Prerequisites
- Latest build of Imagination Network running locally at http://localhost:5173.
- Brave browser (stable or nightly) with access to Shields controls.
- A second Chromium-based browser (Chrome/Edge) or Firefox for control testing.

## Steps

### 1. Brave with Shields enabled (expect Brave messaging)
1. Open Brave and navigate to http://localhost:5173.
2. Ensure Brave Shields are **Up** for the site (default).
3. Launch the onboarding flow (create a new identity or open the welcome modal).
4. Observe the storage warning banner.
5. **Verify** the Brave-specific instructions appear beneath the storage warning, including steps to toggle Shields and reload.

### 2. Brave with Shields disabled (expect no Brave messaging)
1. Click the Brave Shields (lion) icon and toggle **Shields Down** for the site.
2. Reload the page and reopen the onboarding flow.
3. Confirm storage checks now pass (no destructive alert) or, if the banner still shows, the Brave-specific instructions are hidden.

### 3. Non-Brave control (no Brave messaging)
1. Repeat the onboarding flow in Chrome/Edge/Firefox.
2. If storage is intentionally blocked (e.g., private mode), confirm the generic storage warning appears **without** any Brave instructions.

## Expected Results
- Brave-specific guidance renders only in Brave when storage issues are detected.
- Other browsers never show Brave guidance, even if storage fails.
- Disabling Shields or allowing storage resolves the warning after a page reload.
