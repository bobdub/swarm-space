# Fix: screen share never asks for permission

## What's happening

The share button calls the browser's screen-capture request, and the code treats *any* failure as "you cancelled". So when the browser refuses before showing the picker, you see "Screen share cancelled" instantly and never get a prompt.

The most common cause: the Brain is running inside the embedded preview window, and an embedded page is only allowed to capture the screen if the outer page grants that permission. The refusal is immediate and silent. Other possible causes are an unsupported browser (most mobile browsers cannot share a screen at all) or an OS-level block (macOS screen-recording permission).

## What will change

1. Stop calling every failure a cancellation. The button will tell the truth for each case:
   - You closed the picker -> quiet "Screen share cancelled".
   - Blocked because the app is embedded -> "Screen sharing isn't allowed inside the preview window" with an "Open in new tab" action that reopens the Brain in a full tab where sharing works.
   - Browser can't do it (most phones/tablets) -> "This browser can't share a screen; try a desktop browser."
   - Blocked by the system -> "Your system blocked screen recording; allow it in system settings for this browser."
2. Before requesting, check whether sharing is even possible (feature present, and the page is either top-level or explicitly allowed to capture). If not possible, show the matching message with the new-tab action instead of a dead prompt.
3. Show the button in a dimmed "unavailable" state with an explanatory tooltip when the environment can't support sharing, so it doesn't look broken.
4. Log the real underlying error to the console so any remaining case is diagnosable.

## Technical notes

- `BrainUniverseScene.tsx` `toggleScreenShare`: replace the blanket `catch` with error-name branching (`NotAllowedError` + `window.self !== window.top` -> embedded/policy message; `NotAllowedError` top-level -> cancelled/system; `NotSupportedError`/`NotFoundError`/missing API -> unsupported; anything else -> generic with the error message).
- Capability probe helper: `typeof navigator.mediaDevices?.getDisplayMedia === 'function'` plus, when available, `document.featurePolicy`/`document.permissionsPolicy` allows-check for `display-capture`; fall back to allowing the attempt when the check is unavailable.
- "Open in new tab" action uses `window.open(window.location.href, '_blank', 'noopener')`.
- No change to `manager.ts` transport logic; it already rethrows the original error, which is what the new branching reads.
