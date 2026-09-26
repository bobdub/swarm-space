# Brain "Stuck? Ask for help" — AI terrain and collision diagnosis

## What players get
- A new **Help** button (life-ring icon) in the Brain, next to the map and chat buttons.
- It opens a small panel you can drag around, like the chat panel. In it you can:
  - **Upload a screenshot** or tap **Capture view** to grab the current scene automatically.
  - **Describe where you are** in a text box, for example "walking up the volcano, fell under the ground".
  - Automatically attach the on-screen details: altitude, position, nearby landmark (volcano, village, water), and whether weather is in light mode.
- Tap **Diagnose**. The answer appears as it is written:
  - **What's wrong**: for example sinking into the ground, stuck inside a wall or tree, camera under the ground, or falling off the edge of the land.
  - **Recovery steps**: for example "walk downhill toward the village" or "tap Respawn".
  - A **Respawn at village** button, which uses the existing safe spawn.
- Each report can also be copied, so players can share it as a bug report.

## Backend needed
This feature needs Lovable Cloud to run the AI safely on a server. The app currently has no backend. Enabling Cloud is the first step. No login is required to use it.

## Limits and safety
- Images: 5 MB max, PNG, JPEG or WebP only. Large captures are shrunk before upload.
- Screenshots are never stored. They are sent once and then discarded.
- To prevent spam, each player can run one diagnosis every 20 seconds. There is no CAPTCHA.
- Errors are shown clearly: "Too many requests, try again shortly" or "AI credits exhausted".

## Technical details
- Enable Lovable Cloud, then create the edge function `diagnose-terrain`. Follow the Classic AI SDK workflow: `@ai-sdk/openai` `.responses("openai/gpt-6-astra")` with `streamText`, the required `providerOptions.openai` block (`store:false`, reasoning `low`), the run-id fetch, and `sendReasoning:false`. The image is sent as an `input_image` data URL per the multimodal Responses reference.
- The system prompt holds world facts: volcano cone 90 m, land lift 6 m, wade depth 0.9 m, the collision classes (trees, walls, rocks, houses) and the available recovery actions. Output is streamed as markdown sections.
- Status handling: 429 and 402 are passed through with safe messages. There are no automatic retries.
- Client: `src/components/brain/TerrainHelpPanel.tsx`, draggable using the `BrainChatPanel` pointer-capture pattern. Capture uses the R3F `gl.domElement.toDataURL` (needs `preserveDrawingBuffer` or a capture on the next frame). Telemetry comes from `getBodies()` self body plus `radiusFromEarth`. The respawn button reuses `spawnNearSharedVillage`.
- Mount it in `BrainUniverseScene.tsx`. No `<form>`; all buttons use `type="button"`.
- Verify the function with a live test call using a sample screenshot before finishing.
