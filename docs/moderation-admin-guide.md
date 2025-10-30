# Moderation & Sylabis Operations Guide

This guide describes the moderation pipeline introduced in `services/moderation` and how mesh caretakers can operate the new dashboard and scoring tools.

## Service Overview

The `ModerationService` in `services/moderation/index.ts` coordinates three key protections:

1. **Sylabis signup throttling** – Per-origin account creation attempts are hashed using rotating salts and placed into 24-hour buckets. Any origin exceeding the default limit of 10 signups is rejected and recorded as a `sylabis-limit` alert.
2. **Posting throughput enforcement** – Each identity has a rolling last-post timestamp and a daily byte counter. Posts that arrive within 300 ms of the previous submission or that would push the user past the 5 GB/day quota are blocked and surfaced as `post-interval` or `post-volume` alerts.
3. **Content scoring** – Messages are scored for spam likelihood using keyword, repetition, link-density, and account reputation signals. Scores ≥ 0.6 generate a `content-flag` alert so moderators can triage them before sync.

Alerts are retained in-memory (default cap: 200) so UIs and audit tools can quickly summarize activity without querying storage. The helper exported from `src/lib/moderation/dashboard.ts` can call an API endpoint or fall back to locally cached JSON to keep the dashboard responsive offline.

## Moderator Console Workflow

1. Navigate to **Moderation** from the primary navigation bar. The dashboard fetches `/api/moderation/dashboard` when available and gracefully falls back to local samples if the gateway is offline.
2. Review the **summary cards** for spikes in Sylabis limits, velocity blocks, or flagged content. Percentages display the share of each alert type in the current window.
3. Inspect the **High-risk queue** for content flagged by the scoring heuristics. Click an item to view its associated post in your existing tooling, and resolve or dismiss it in your admin workflow.
4. Use **Recent triggers** to monitor hourly trends. Sudden increases in `post-volume` or `sylabis-limit` counts indicate coordinated abuse.
5. Audit the **All recent alerts** table before rotating salts or adjusting thresholds. This view combines rate limits and scoring events, making it easier to export evidence if needed.

## Operating Tips

- Rotate the Sylabis salt regularly and distribute it via secure channels so per-origin hashing remains collision resistant.
- Adjust the service constructor options if your mesh requires more lenient throughput. Lower-risk communities can raise the alert threshold, while sensitive deployments may drop it closer to 0.5.
- Persist `ModerationService.getAlerts()` to durable storage if you want a long-term audit log. The service exposes a `reset()` helper so testing harnesses can start from a clean slate.
- Populate `localStorage["moderation.alerts"]` with serialized `AlertRecord` objects to seed the dashboard during demos or offline rehearsals.

## Testing

Bun tests target the scoring logic in `services/moderation/__tests__/scoring.test.ts`. Run `bun test` to verify spam heuristics continue to identify keyword attacks, link-heavy posts, and normal traffic correctly.
