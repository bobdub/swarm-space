# Make personal-server probe errors visible

## Confirmed issue

- The existing-server **Re-probe** button already builds a detailed toast from the failing probe step.
- The **Add server** wizard still renders the generic sentence “Probe failed,” which matches the message being reported.
- If the initial write fails, `probePersonalServer` returns immediately before saving the failed step into the server record, so the row cannot preserve or display the real reason.
- No matching browser console or captured network entry was available, so the server-side cause remains unconfirmed until the app exposes the actual error.

## Changes

1. In the add-server wizard, replace the generic failure notice with the first failed step and its complete error message. Keep the message visible in the dialog rather than relying only on a short-lived toast.
2. In the probe function, use one completion path so every result—including an immediate write failure—is saved to `server.health.steps` and `server.health.error` before returning.
3. Add a guarded catch around the existing-server probe action so an unexpected thrown error is also shown explicitly and does not leave the user with no diagnosis.
4. Keep the storage protocol, credentials, signing, and server configuration unchanged until the newly exposed error identifies the actual fault.

## Verification

- Open Settings → Personal Servers in the live preview and run the same test path used for “bobs server.”
- Confirm the interface shows a named step such as **write failed** plus the full reason, not only “Probe failed.”
- Confirm the same detail remains visible on the server row after the toast closes.
- If a reachable test endpoint is available, also confirm successful write/read/delete still reports **Server healthy**.
- Report the newly exposed message as the diagnosis; do not claim the server connection itself is fixed unless all three probe steps pass.

## Scope

Only the personal-server wizard, panel error guard, and probe result persistence will change. No mesh, wallet, Brain, vault, encryption, or adapter protocol behavior will be altered.