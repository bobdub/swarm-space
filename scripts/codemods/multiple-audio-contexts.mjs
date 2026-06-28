#!/usr/bin/env node
/**
 * Replace `new AudioContext()` (and webkit variant) with the shared singleton
 * import. Inserts the import if missing. Assumes the helper lives at
 * `@/lib/streaming/audioCtx` — create it if it does not yet exist.
 */
import { loadArgs, save } from './_lib.mjs';
const { file, src } = loadArgs();
let out = src;
const ctorRe = /new\s+(?:window\.)?(?:webkit)?AudioContext\s*\([^)]*\)/g;
if (!ctorRe.test(out)) {
  save(file, out, src);
  process.exit(0);
}
out = out.replace(ctorRe, 'getSharedAudioContext()');
if (!/from\s+['"]@\/lib\/streaming\/audioCtx['"]/.test(out)) {
  out = `import { getSharedAudioContext } from "@/lib/streaming/audioCtx";\n` + out;
}
save(file, out, src);
