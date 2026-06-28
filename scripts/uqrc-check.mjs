#!/usr/bin/env node
/**
 * UQRC Consistency Check — Infinity Protocol gate.
 *
 * Static-analysis pass that flags logical contradictions (violations of
 * Core memory rules) and surfaces hidden dependencies / high-curvature
 * stress files before changes ship.
 *
 * Two outputs:
 *   1. CONTRADICTIONS — hard-fail list, mapped from project Core rules.
 *   2. STRESS MAP    — per-file Q_Score proxy:
 *        Q ≈ ||[D_μ,D_ν]||  +  ||∇∇S||  +  λ(ε₀)
 *      where:
 *        ||commutator||  ≈ imports · exports / lines      (coupling × surface)
 *        ||entropy||     ≈ branches / lines               (decision density)
 *        λ(ε₀)           ≈ 1e-6                           (floor)
 *
 * Exit 1 if any contradiction is found. Stress map is informational.
 *
 * Run: `node scripts/uqrc-check.mjs` (or `bun run uqrc:check`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXTS = new Set(['.ts', '.tsx']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '__tests__']);

/** @type {{file:string,line:number,rule:string,msg:string}[]} */
const contradictions = [];
const stress = [];

// ── Allowlists (intentional exceptions to Core rules) ───────────────────
const FORM_ALLOWLIST = new Set([
  'src/components/ui/form.tsx', // shadcn wrapper, never renders <form> itself
]);
const AUDIO_CTX_ALLOWLIST = new Set([
  'src/components/streaming/PersistentAudioLayer.tsx',
  'src/lib/streaming/avPriority.ts',
  'src/hooks/useActiveSpeaker.ts',
]);

// ── Removed-legacy module names (importing these = ghost dependency) ────
const REMOVED_MODULES = [
  'useLiveRoomMedia',
  'StreamingRoomTray',
  'LiveStreamControls',
];

// ── Walk ────────────────────────────────────────────────────────────────
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(full.slice(full.lastIndexOf('.')))) yield full;
  }
}

function rel(p) { return relative(ROOT, p).split(sep).join('/'); }

// ── Rules ───────────────────────────────────────────────────────────────
function checkContradictions(file, src) {
  const r = rel(file);
  const lines = src.split('\n');

  // R1: No <form> JSX (project memory: Forms/UI Core rule).
  if (!FORM_ALLOWLIST.has(r)) {
    lines.forEach((ln, i) => {
      if (/<form[\s>]/i.test(ln) && !/role=["']form["']/.test(ln)) {
        contradictions.push({ file: r, line: i + 1, rule: 'no-native-form',
          msg: 'Native <form> element — use <div role="form"> + <button type="button">.' });
      }
    });
  }

  // R2: No role/admin checks via client-side storage.
  lines.forEach((ln, i) => {
    if (/(localStorage|sessionStorage)\s*\.\s*getItem\([^)]*(role|admin|isAdmin)/i.test(ln)) {
      contradictions.push({ file: r, line: i + 1, rule: 'client-side-role-check',
        msg: 'Role/admin status read from client storage — must use server-side validation.' });
    }
  });

  // R3: WebRTC Limits — single shared AudioContext.
  if (!AUDIO_CTX_ALLOWLIST.has(r)) {
    lines.forEach((ln, i) => {
      if (/new\s+(window\.)?(webkit)?AudioContext\s*\(/.test(ln)) {
        contradictions.push({ file: r, line: i + 1, rule: 'multiple-audio-contexts',
          msg: 'New AudioContext instance — use the shared singleton in avPriority.ts.' });
      }
    });
  }

  // R4: Never delete IndexedDB on VersionError.
  lines.forEach((ln, i) => {
    if (/deleteDatabase\s*\(/.test(ln) && !/\/\/\s*allow-delete-db/.test(ln)) {
      contradictions.push({ file: r, line: i + 1, rule: 'destructive-db-upgrade',
        msg: 'indexedDB.deleteDatabase() — non-destructive upgrade required (annotate with // allow-delete-db if intentional).' });
    }
  });

  // R5: Ghost imports — references to removed legacy modules.
  REMOVED_MODULES.forEach((mod) => {
    lines.forEach((ln, i) => {
      if (new RegExp(`from\\s+['"][^'"]*${mod}['"]`).test(ln)) {
        contradictions.push({ file: r, line: i + 1, rule: 'ghost-dependency',
          msg: `Imports removed legacy module "${mod}" — delete or replace.` });
      }
    });
  });

  // R6: Local content protection — direct overwrites of _origin: 'local'.
  lines.forEach((ln, i) => {
    if (/_origin\s*[:=]\s*['"]local['"]/.test(ln) && /delete|=\s*undefined|=\s*null/.test(ln)) {
      contradictions.push({ file: r, line: i + 1, rule: 'local-origin-overwrite',
        msg: 'Mutating/removing _origin: "local" marker — local posts must be protected from P2P overwrites.' });
    }
  });
}

// ── Q_Score per file ────────────────────────────────────────────────────
function qScoreFile(file, src) {
  const lines = src.split('\n').length || 1;
  const imports = (src.match(/^\s*import\s+/gm) || []).length;
  const exports = (src.match(/^\s*export\s+/gm) || []).length;
  const branches = (src.match(/\b(if|for|while|switch|catch|case)\b/g) || []).length;

  const commutator = (imports * Math.max(exports, 1)) / lines;
  const entropy = branches / lines;
  const q = commutator + entropy + 1e-6;
  return { file: rel(file), lines, imports, exports, branches, q };
}

// ── Run ─────────────────────────────────────────────────────────────────
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  checkContradictions(file, src);
  stress.push(qScoreFile(file, src));
}

// ── Report ──────────────────────────────────────────────────────────────
const RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', DIM = '\x1b[2m', RST = '\x1b[0m';

console.log(`\n${DIM}═══ UQRC Consistency Check — Infinity Protocol gate ═══${RST}\n`);

if (contradictions.length === 0) {
  console.log(`${GRN}✓ No contradictions found.${RST}  (‖[D_μ,D_ν]‖ ≈ 0)\n`);
} else {
  console.log(`${RED}✗ ${contradictions.length} contradiction(s):${RST}\n`);
  const byRule = new Map();
  for (const c of contradictions) {
    if (!byRule.has(c.rule)) byRule.set(c.rule, []);
    byRule.get(c.rule).push(c);
  }
  for (const [rule, items] of byRule) {
    console.log(`  ${RED}● ${rule}${RST} (${items.length})`);
    for (const it of items.slice(0, 20)) {
      console.log(`    ${it.file}:${it.line}  ${DIM}${it.msg}${RST}`);
    }
    if (items.length > 20) console.log(`    ${DIM}…and ${items.length - 20} more${RST}`);
  }
  console.log('');
}

stress.sort((a, b) => b.q - a.q);
const top = stress.slice(0, 12);
console.log(`${DIM}── Top stress files (Q_Score = commutator + entropy + λε₀) ──${RST}`);
for (const s of top) {
  const tag = s.q > 0.3 ? RED : s.q > 0.15 ? YEL : GRN;
  console.log(`  ${tag}${s.q.toFixed(3)}${RST}  ${s.file}  ${DIM}(${s.lines} ln, ${s.imports} imp, ${s.exports} exp, ${s.branches} br)${RST}`);
}
console.log('');

process.exit(contradictions.length > 0 ? 1 : 0);