# Observability automation runbook

## Purpose

The node dashboard now exposes an observability banner that wires together three alerting systems:

1. **Webhook configuration** – operators can enable/disable delivery and edit the endpoint + shared secret from the UI.
2. **Automation scheduler** – Miniflare verification suites are queued on a rolling interval and run immediately when requested.
3. **Alert history** – every Miniflare execution and webhook notification is persisted to local storage for quick recall.

Together these pieces highlight whether alerts are flowing, when the last verification succeeded, and when the next one is due.

## Key signals in the UI

- **Status badges**
  - `Suite healthy` (primary badge) – most recent automation run completed without failures.
  - `Suite warnings` (secondary badge) – automation succeeded but reported partial issues (non-zero failure count).
  - `Suite failed` (destructive badge) – last suite run failed to execute or reported a fatal error.
  - `Awaiting suite` (outline badge) – automation has not yet executed on this browser session.
- **Webhook indicator** – shows whether deliveries are enabled and the currently configured endpoint (truncated for readability).
- **Schedule metadata** – "Next run" badge counts down to the next scheduled suite; "Last run" shows how long ago the previous suite completed.
- **Recent alert activity** – the last four alert events (Miniflare runs, webhook events, system notices) with relative timestamps.

## Storage and persistence

State lives entirely in the browser so operators can experiment safely on staging builds:

- Webhook configuration is stored under `alerts:webhook-config:v1` in `localStorage`.
- Automation scheduling metadata is stored in `alerts:automation-state:v1`.
- Alert history lives in `alerts:history:v1` (most recent 50 entries retained).

Clearing the browser's storage resets the UI, though webhook payload receivers may still have historical records.

## Running automation manually

1. Open the node dashboard and locate the **Observability automation** banner.
2. Verify deliveries are enabled. Toggle the webhook switch if you need to pause outgoing posts without losing settings.
3. Click **Run suite now** to start a Miniflare verification immediately. The button disables while the suite is running.
4. Watch the status badges and alert activity list update. A successful run pushes a `miniflare` info event; warnings/errors emit higher severity records.

## Editing webhook configuration

1. Press **Edit webhook** in the banner.
2. Provide the endpoint URL where alerts should post. Optionally include a secret for downstream validation.
3. Enable or disable deliveries as required.
4. Save changes to persist them locally. The banner updates instantly and subsequent automations reference the new values.

## Scheduling behaviour

- Automation defaults to a 15 minute cadence per browser session. Closing the dashboard pauses timers until a session reinitializes.
- Any manual run resets the timer, so the next scheduled execution occurs one full interval after completion.
- Failed runs keep the failure badge and last error message visible until a subsequent success clears the condition.

## Troubleshooting

| Symptom | Suggested action |
| --- | --- |
| Badge reads "Suite failed" | Inspect the latest alert entry for error details, adjust webhook endpoint or rerun manually. |
| Next run badge never appears | Ensure the dashboard tab stays open; timers pause in backgrounded or throttled tabs. |
| Alerts not reaching downstream systems | Confirm the webhook switch is enabled and re-enter credentials via **Edit webhook**. |
| History looks stale after deploying a new build | Clear `localStorage` keys above to reset state or open in a fresh browser profile. |

Keep this runbook alongside other swarm operational guides so on-call caretakers understand how to verify alerting health quickly.
