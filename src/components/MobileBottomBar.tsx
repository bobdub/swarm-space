/**
 * MobileBottomBar — intentionally disabled.
 *
 * Removed per UX direction: users should leave the Brain via in-app
 * affordances (top nav / route changes) before encountering social-site
 * chrome. Keeping the export as a no-op so existing imports stay valid
 * without churn across the app shell.
 */
export function MobileBottomBar() {
  return null;
}