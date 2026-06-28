import { readFileSync, writeFileSync } from 'node:fs';
export function loadArgs() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/codemods/<id>.mjs <file>');
    process.exit(1);
  }
  return { file, src: readFileSync(file, 'utf8') };
}
export function save(file, out, before) {
  if (out === before) {
    console.log(`no changes: ${file}`);
    return;
  }
  writeFileSync(file, out);
  console.log(`rewrote: ${file}`);
}
