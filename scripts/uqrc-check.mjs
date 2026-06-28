#!/usr/bin/env node
/**
 * UQRC Consistency Check — Infinity Protocol gate.
 *
 * Static-analysis pass that flags logical contradictions (violations of
 * Core memory rules), emits a rule-specific "likely fix" hint for each,
 * and ranks per-file Q_Score stress.
 *
 * Modes:
 *   default  → advisory (exit 0, always prints findings + hints)
 *   --strict → exit 1 on any contradiction (CI / pre-ship gate)
 *   --json   → also write src/lib/uqrc/baseline.json (top-stress snapshot
 *              the live AppHealth bus seeds on boot)
 *
 * Per-line suppression: `// uqrc-allow: <rule-id>` (same/previous line).
 *
 * Each rule may declare a `codemod` slug; when present a hint at the
 * bottom of the report shows: `bun run uqrc:fix <rule-id> <file>`.
 *
 * Run: `node scripts/uqrc-check.mjs [--strict] [--json]`
 */
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXTS = new Set(['.ts', '.tsx']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '__tests__']);

const FORM_ALLOWLIST = new Set(['src/components/ui/form.tsx']);
const AUDIO_CTX_ALLOWLIST = new Set([
  'src/components/streaming/PersistentAudioLayer.tsx',
  'src/lib/streaming/avPriority.ts',
  'src/hooks/useActiveSpeaker.ts',
]);
const REMOVED_MODULES = ['useLiveRoomMedia', 'StreamingRoomTray', 'LiveStreamControls'];

// ── Rule registry ───────────────────────────────────────────────────────
const RULES = [
  {
    id: 'no-native-form',
    message: 'Native <form> element — violates "no native forms" Core rule.',
    hint: [
      'Replace with a non-submitting container:',
      '  <div role="form" aria-label="...">',
      '    ...inputs...',
      '    <button type="button" onClick={handleSubmit}>Save</button>',
      '  </div>',
      'Prevents page reloads from implicit Enter-key submit.',
    ].join('\n'),
    codemod: 'no-native-form',
    scan(file, lines, push, suppressed) {
      if (FORM_ALLOWLIST.has(file)) return;
      lines.forEach((ln, i) => {
        if (/<form[\s>]/i.test(ln) && !/role=["']form["']/.test(ln) && !suppressed(i, 'no-native-form')) {
          push(i + 1);
        }
      });
    },
  },
  {
    id: 'client-side-role-check',
    message: 'Role/admin status read from client storage — privilege-escalation risk.',
    hint: [
      'Move the check server-side. With Lovable Cloud:',
      '  const { data } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });',
      'Never trust localStorage / sessionStorage for authz.',
    ].join('\n'),
    scan(file, lines, push, suppressed) {
      lines.forEach((ln, i) => {
        if (/(localStorage|sessionStorage)\s*\.\s*getItem\([^)]*(role|admin|isAdmin)/i.test(ln) && !suppressed(i, 'client-side-role-check')) {
          push(i + 1);
        }
      });
    },
  },
  {
    id: 'multiple-audio-contexts',
    message: 'New AudioContext instance — multiple contexts crash browsers under load.',
    hint: [
      'Use the single shared context. If a helper does not yet exist, add:',
      '  // src/lib/streaming/audioCtx.ts',
      '  let ctx: AudioContext | null = null;',
      '  export const getSharedAudioContext = () => (ctx ??= new AudioContext());',
      'Then: import { getSharedAudioContext } from "@/lib/streaming/audioCtx";',
    ].join('\n'),
    codemod: 'multiple-audio-contexts',
    scan(file, lines, push, suppressed) {
      if (AUDIO_CTX_ALLOWLIST.has(file)) return;
      lines.forEach((ln, i) => {
        if (/new\s+(window\.)?(webkit)?AudioContext\s*\(/.test(ln) && !suppressed(i, 'multiple-audio-contexts')) {
          push(i + 1);
        }
      });
    },
  },
  {
    id: 'destructive-db-upgrade',
    message: 'indexedDB.deleteDatabase() — destructive upgrade violates DB Upgrade Core rule.',
    hint: [
      'Run a non-destructive migration instead:',
      '  request.onupgradeneeded = (ev) => addMissingStores(ev.target.result);',
      '  db.onversionchange = () => db.close();   // let other tabs upgrade',
      'If this really is a corruption recovery path, annotate with',
      '  // allow-delete-db   (or)   // uqrc-allow: destructive-db-upgrade',
    ].join('\n'),
    codemod: 'destructive-db-upgrade',
    scan(file, lines, push, suppressed) {
      lines.forEach((ln, i) => {
        if (/deleteDatabase\s*\(/.test(ln) && !/\/\/\s*allow-delete-db/.test(ln) && !suppressed(i, 'destructive-db-upgrade')) {
          push(i + 1);
        }
      });
    },
  },
  {
    id: 'ghost-dependency',
    message: 'Import of a removed legacy module.',
    hint: 'Delete the import — the module has been removed. If you still need the behaviour, port it into the new owner module instead of resurrecting the file.',
    scan(file, lines, push, suppressed) {
      REMOVED_MODULES.forEach((mod) => {
        const re = new RegExp(`from\\s+['"][^'"]*${mod}['"]`);
        lines.forEach((ln, i) => {
          if (re.test(ln) && !suppressed(i, 'ghost-dependency')) push(i + 1, mod);
        });
      });
    },
  },
  {
    id: 'local-origin-overwrite',
    message: 'Mutating/removing _origin: "local" — local posts must be protected from P2P upserts.',
    hint: 'Skip the upsert when `existing._origin === "local"`. See `mem://architecture/local-content-persistence`.',
    scan(file, lines, push, suppressed) {
      lines.forEach((ln, i) => {
        if (/_origin\s*[:=]\s*['"]local['"]/.test(ln) && /delete|=\s*undefined|=\s*null/.test(ln) && !suppressed(i, 'local-origin-overwrite')) {
          push(i + 1);
        }
      });
    },
  },
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

const contradictions = [];
const stress = [];

function checkContradictions(file, src) {
  const r = rel(file);
  const lines = src.split('\n');
  const suppressed = (i, rule) => {
    const same = lines[i] || '';
    const prev = lines[i - 1] || '';
    const tag = new RegExp(`uqrc-allow:\\s*${rule}\\b`);
    return tag.test(same) || tag.test(prev);
  };
  for (const rule of RULES) {
    const push = (line, detail) => {
      contradictions.push({
        file: r, line, rule: rule.id,
        msg: detail ? `${rule.message} (${detail})` : rule.message,
        hint: rule.hint, codemod: rule.codemod ?? null,
      });
    };
    rule.scan(r, lines, push, suppressed);
  }
}

function qScoreFile(file, src) {
  const lines = src.split('\n').length || 1;
  const imports = (src.match(/^\s*import\s+/gm) || []).length;
  const exports = (src.match(/^\s*export\s+/gm) || []).length;
  const branches = (src.match(/\b(if|for|while|switch|catch|case)\b/g) || []).length;
  const commutator = (imports * Math.max(exports, 1)) / lines;
  const entropy = branches / lines;
  return { file: rel(file), lines, imports, exports, branches, q: commutator + entropy + 1e-6 };
}

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
  for (const [ruleId, items] of byRule) {
    const ruleDef = RULES.find((r) => r.id === ruleId);
    console.log(`  ${RED}● ${ruleId}${RST} (${items.length})`);
    for (const it of items.slice(0, 20)) {
      console.log(`    ${it.file}:${it.line}  ${DIM}${it.msg}${RST}`);
    }
    if (items.length > 20) console.log(`    ${DIM}…and ${items.length - 20} more${RST}`);
    if (ruleDef?.hint) {
      console.log(`    ${YEL}↳ likely fix:${RST}`);
      for (const ln of ruleDef.hint.split('\n')) console.log(`      ${DIM}${ln}${RST}`);
    }
    if (ruleDef?.codemod) {
      console.log(`    ${YEL}↳ codemod:${RST} ${DIM}bun run uqrc:fix ${ruleDef.codemod} <file>${RST}`);
    }
    console.log('');
  }
}

stress.sort((a, b) => b.q - a.q);
const top = stress.slice(0, 12);
console.log(`${DIM}── Top stress files (Q_Score = commutator + entropy + λε₀) ──${RST}`);
for (const s of top) {
  const tag = s.q > 0.3 ? RED : s.q > 0.15 ? YEL : GRN;
  console.log(`  ${tag}${s.q.toFixed(3)}${RST}  ${s.file}  ${DIM}(${s.lines} ln, ${s.imports} imp, ${s.exports} exp, ${s.branches} br)${RST}`);
}
console.log('');

if (JSON_OUT) {
  const baselinePath = join(SRC, 'lib/uqrc/baseline.json');
  mkdirSync(dirname(baselinePath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    topStress: stress.slice(0, 24).map(({ file, q }) => ({ file, q: Number(q.toFixed(4)) })),
    contradictionCount: contradictions.length,
  };
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
  console.log(`${DIM}wrote baseline → ${rel(baselinePath)}${RST}\n`);
}

if (contradictions.length > 0 && !STRICT) {
  console.log(`${DIM}Run with --strict to fail on contradictions. Suppress individual lines with \`// uqrc-allow: <rule>\`.${RST}\n`);
}
process.exit(STRICT && contradictions.length > 0 ? 1 : 0);
