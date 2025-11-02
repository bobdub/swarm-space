# Capsule publishing alerts

The capsule publishing script (`bun run ops/scripts/publish-capsule.ts`) now tracks consecutive
failures. State is persisted in `.capsule-alerts.json` within this directory.

## Environment variables

- `RENDEZVOUS_CAPSULE_ALERT_THRESHOLD` (default: `3`) – number of consecutive failures before a
  console alert is emitted.

On recovery (a successful publish after an alert), a recovery notification is printed.

## State file

The alert service records the failure streak, timestamps, and last failure message. Deleting the
`.capsule-alerts.json` file resets the streak counter.
