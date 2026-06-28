#!/usr/bin/env node
/**
 * Rewrite `<form ...>` → `<div role="form" ...>` and strip `onSubmit`.
 * Conservative: leaves a TODO marker so reviewer wires handleSubmit to a button.
 */
import { loadArgs, save } from './_lib.mjs';
const { file, src } = loadArgs();
let out = src;
// open tag: <form ...> → <div role="form" ...>
out = out.replace(/<form(\s[^>]*)?>/g, (_m, attrs = '') => {
  let a = attrs || '';
  a = a.replace(/\s*onSubmit\s*=\s*\{[^}]*\}/g, '');
  if (!/role\s*=\s*["']form["']/.test(a)) a = ` role="form"${a}`;
  return `<div${a}>  {/* TODO(uqrc): wire submit to a <button type="button" onClick={handleSubmit}> */}`;
});
out = out.replace(/<\/form>/g, '</div>');
save(file, out, src);
