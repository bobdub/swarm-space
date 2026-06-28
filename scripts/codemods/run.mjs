#!/usr/bin/env node
/** Dispatcher: `bun run uqrc:fix <rule-id> <file>` */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [, , rule, file] = process.argv;
if (!rule || !file) {
  console.error('Usage: bun run uqrc:fix <rule-id> <file>');
  process.exit(1);
}
const mod = join(here, `${rule}.mjs`);
if (!existsSync(mod)) {
  console.error(`no codemod for rule "${rule}"`);
  process.exit(1);
}
const r = spawnSync('node', [mod, file], { stdio: 'inherit' });
process.exit(r.status ?? 0);
