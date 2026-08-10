# Fix "Probe failed" on personal servers

## What's happening

The probe (write -> read -> delete of a 1 KiB test blob) already records a
per-step reason for every failure, but the Settings panel throws that detail
away and shows the single word "Probe failed". So right now there is no way to
tell whether bobs server rejected the credentials, blocked the browser via
CORS, was unreachable, or signed the request wrong.

Confirmed in code:
- `probePersonalServer` (personalServerProvider.ts) returns
  `{ ok, steps: [{ step, ok, error }] }` with the real message per step.
- `PersonalServersPanel.tsx` line 35 renders only `'Probe failed'` and drops
  `result.steps` entirely.
- The S3 adapter throws `S3 PUT failed: <status> <body>` for HTTP errors, but a
  browser-blocked request (CORS / DNS / TLS / offline tailnet) surfaces as a bare
  `TypeError: Failed to fetch` with no explanation.

The root cause of bobs server failing is not yet identified — it cannot be from
outside the user's tailnet. Step 1 makes the app tell us.

## Step 1 — Surface the real failure (diagnosis)

- In `PersonalServersPanel.tsx`, show the first failing step and its message in
  the toast (e.g. "Probe failed at write: S3 PUT failed: 403 SignatureDoesNotMatch"),
  and keep the full step list visible on the server row after a probe.
- Store the last probe steps on the server record so the row can show
  "write ok / read failed" chips instead of just a red dot.

## Step 2 — Classify the common failure modes

In the S3 and HTTPS-blob adapters, wrap `fetch` so a thrown `TypeError` becomes
an actionable message instead of "Failed to fetch":

- Network/CORS: "Browser could not reach <host>. Check the server is online on
  your tailnet and that CORS allows this origin (PUT, GET, DELETE, plus
  Authorization / x-amz-* headers)."
- 403 / SignatureDoesNotMatch: "Access key or secret rejected, or the region
  does not match. MinIO usually needs region `us-east-1`."
- 404 on bucket: "Bucket <name> not found at <endpoint>."
- 405 / 501: "Endpoint does not support path-style requests."

## Step 3 — Fix the actual cause

With the real message in hand, apply the targeted fix. The likely candidates,
in order, for a MinIO-on-tailscale endpoint:

1. MinIO CORS not allowing the app origin and the signed headers -> documented
   fix in the personal-server guide plus an inline hint in the panel.
2. Region mismatch (`auto` vs `us-east-1`) -> allow editing region on an
   existing server instead of only at creation.
3. Bucket missing or wrong path-style key -> surfaced by the 404 message.

No adapter signing logic changes unless the error text proves a signing bug.

## Scope

Touches only:
- `src/components/settings/PersonalServersPanel.tsx` (error display)
- `src/lib/storage/providers/adapters/s3Compatible.ts` and `httpsBlob.ts`
  (error message wrapping only, no protocol change)
- `src/lib/storage/providers/personalServerStore.ts` (persist last probe steps)
- `src/pages/PersonalServerGuide.tsx` (CORS/region troubleshooting section)

Nothing in the mesh, wallet, brain, or vault paths changes.

## Verification

Run the probe on bobs server from Settings and read the exact step error, then
confirm the probe reports "Server healthy" after the fix. I will not call it
fixed until the probe passes with a green write/read/delete.
