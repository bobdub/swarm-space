# Fix Firefox screen sharing in the Brain

## Confirmed diagnosis

The current click handler calls `manager.startScreenShare()`, and that method combines two separate operations in one `try`: asking Firefox for the screen and publishing the selected track to peer connections. The UI catches every error from either operation and replaces it with "Screen share cancelled." This hides the actual Firefox error and can also misreport a WebRTC publishing failure as a capture cancellation.

The exact reason Firefox rejects before showing its picker is not present in the captured logs, so the implementation will first preserve and surface its real error rather than assume an iframe issue. The live site response does not currently include a `Permissions-Policy` header that disables display capture.

## What will change

1. Split capture from publishing. The Brain's actual icon click will call Firefox's native `getDisplayMedia({ video: true, audio: false })` directly while it still has the trusted click activation. This makes the browser picker the first and only operation before the first `await`.
2. Pass the successfully captured stream into the WebRTC manager through a dedicated `publishScreenStream(stream)` method. A publishing failure will stop the selected track and report a connection error, not "cancelled."
3. Preserve Firefox's real capture error (`name`, `message`, secure-context status, top-level/embedded status, API availability) in diagnostics. Map only `AbortError` to cancellation; do not assume `NotAllowedError` means the user cancelled.
4. Handle Firefox-specific capture failures truthfully:
   - `InvalidStateError`: explain that the request lacked an active click and retry only from a fresh button press.
   - `NotAllowedError`: explain that Firefox or the OS blocked capture and retain the detailed error in logs.
   - Missing API/`NotSupportedError`: mark screen sharing unavailable in that browser context.
   - Embedded-only denial: offer opening the same Brain in a full tab, but only when the runtime confirms it is embedded.
5. Keep the existing voice stream untouched during capture, publishing, stopping, and errors.
6. Verify the live interaction in a browser: clicking the icon must open the native share picker; after selection, the local screen tile appears; stopping from either Firefox or the same icon removes it while voice remains active.

## Technical notes

- `BrainUniverseScene.tsx`: perform the native capture synchronously from `toggleScreenShare`, then publish the returned stream; retain the same button for stopping.
- Screen share uses `navigator.mediaDevices.getDisplayMedia` — a separate browser API from the camera path (`getUserMedia`). The `video: true` inside `getDisplayMedia` selects the screen's picture; it never enables the webcam, and sharing works with the camera off.
- `manager.ts`: separate `getDisplayMedia` from the sender replacement/renegotiation path and guarantee cleanup if publishing fails.
- Avoid a preflight Permissions API query: browsers intentionally do not grant persistent screen-capture permission, and the native picker is the source of truth.
- Keep screen audio disabled so microphone voice remains on its existing audio sender.
