/** Personality realization uses whole learned expressions, never shuffled glyphs.
 * Lexical relevance is a local heuristic, not a claim of semantic understanding.
 * UQRC ranks eligible whole candidates in DualLearningFusion after these checks.
 */
export interface LearnedExpression {
  text: string;
  weight: number;
  source: 'memory' | 'personality';
}

export const MAX_EXPRESSIONS = 256;
const MAX_EXPRESSION_LENGTH = 1000;
const STOP_WORDS = new Set('a an the is are was were be been to of in on at and or for from with it this that i you my your me we our how what why can do does tell about'.split(' '));
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
const topics = (text: string): Set<string> => new Set(words(text).filter(w => w.length > 2 && !STOP_WORDS.has(w)));

/** Store only complete expressions. Symbolic lines remain atomic, including decimals. */
export function extractExpressions(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/).map(s => s.trim())) {
    const symbolic = /[=Ψ⊗ℓ⟩⟨μν𝒟𝒪∇Δλε‖↔ℛ]/u.test(line);
    const segments = symbolic ? [line] : line.match(/[^.!?]+(?:[.!?]+[”’"']?(?=\s|$))/g) ?? [];
    for (const segment of segments) {
      const expression = segment.trim();
      if (expression.length < 8 || expression.length > MAX_EXPRESSION_LENGTH) continue;
      if (!symbolic && words(expression).length < 3) continue;
      if (!hasBalancedNotation(expression)) continue;
      out.push(expression);
    }
  }
  return [...new Set(out)];
}

export function hasBalancedNotation(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{', '⟩': '⟨' };
  const stack: string[] = [];
  for (const ch of text) {
    // Ket notation |Ψ⟩ uses a vertical bar instead of an opening angle.
    if (ch === '(' || ch === '[' || ch === '{' || ch === '⟨') stack.push(ch);
    else if (ch in pairs) {
      if (ch === '⟩' && stack.at(-1) !== '⟨' && text.includes('|')) continue;
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

/** Reject equality and copied openings even when a glyph prefix disguises them. */
export function echoesPrompt(candidate: string, prompt: string): boolean {
  const p = words(prompt);
  const c = words(candidate);
  if (!p.length || !c.length) return false;
  if (c.join(' ') === p.join(' ')) return true;
  if (p.length < 2) return false;
  return c.some((word, i) => word === p[0] && c[i + 1] === p[1]);
}

export interface RealizationContext {
  recentPosts: string[];
  maxChars: number;
  personality?: { awareness: number; empathy: number; coherence: number; intent: number; phase: string };
}

/** Personality controls cadence/budget; relevance comes first, never glyph presence. */
export function rankExpressions(expressions: LearnedExpression[], context: RealizationContext): LearnedExpression[] {
  const prompt = context.recentPosts[0] ?? '';
  const wanted = topics(prompt);
  if (!wanted.size) return [];
  const coherence = Math.min(1, Math.max(0, context.personality?.coherence ?? 0.5));
  const ranked = expressions.flatMap(expression => {
    if (expression.text.length > context.maxChars || echoesPrompt(expression.text, prompt)) return [];
    const tokens = topics(expression.text);
    const shared = [...wanted].filter(t => tokens.has(t)).length;
    if (!shared || !hasBalancedNotation(expression.text)) return [];
    const coverage = shared / wanted.size;
    // Stable personality favors concise, well-supported expressions. No padding.
    const support = Math.min(1, expression.weight / 5);
    const cadence = 1 / (1 + expression.text.length / 400);
    const score = coverage * 4 + support * 0.3 + cadence * coherence * 0.2;
    return [{ expression, score }];
  });
  return ranked.sort((a, b) => b.score - a.score || a.expression.text.localeCompare(b.expression.text))
    .slice(0, 4).map(item => item.expression);
}