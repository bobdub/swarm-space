#!/usr/bin/env node
/**
 * Annotate `indexedDB.deleteDatabase(x)` call sites with a TODO pointing to
 * the non-destructive upgrade helper. Does NOT auto-delete the call.
 */
import { loadArgs, save } from './_lib.mjs';
const { file, src } = loadArgs();
const out = src.replace(/^(\s*)(.*deleteDatabase\s*\([^)]*\).*)$/gm,
  (_m, indent, body) =>
    `${indent}// TODO(uqrc): replace destructive deleteDatabase with a non-destructive\n` +
    `${indent}// onupgradeneeded migration. If this is corruption-recovery, annotate:\n` +
    `${indent}// uqrc-allow: destructive-db-upgrade\n` +
    `${indent}${body}`);
save(file, out, src);
