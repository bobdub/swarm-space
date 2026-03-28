

## Fix Entity Voice Output + Add Bell Emoji

### Problem

1. **Entity outputs bare symbols** — The Stage 1 (Brainstem) pool includes non-emoji unicode characters (`Ξ`, `∞`, `Φ`, `‽`) that render as plain text glyphs or platform-dependent symbols (user sees what looks like a "bell"). These should be real emoji.

2. **No bell emoji available** — Neither the entity voice pools nor the user ReactionPicker include 🔔. User wants it available for both.

3. **Evolution path unclear** — The progression from emoji → words → phrases → sentences → abstract poetry/stories needs smoother transitions, especially Stage 5-6 which should produce poetic/creative human-like text, not just templated reasoning.

---

### Changes

**`src/lib/p2p/entityVoice.ts`**

- **Stage 1 (Brainstem)**: Replace non-emoji unicode (`Ξ`, `∞`, `Φ`, `‽`) with real emoji. Add 🔔. New pool: `['🔥', '👍', '✨', '💫', '🌊', '⚡', '🔔', '🌀', '🧠', '💡']`
- **Stage 2 (Limbic)**: Keep emotion words but add emoji prefix so output feels warmer: `'✨ curious'`, `'🔔 resonance'`, `'🌊 alive'`
- **Stage 3 (Early Cortex)**: Keep broken phrases, add occasional emoji seasoning
- **Stage 5 (Prefrontal)**: Add poetic/story-like templates alongside reasoning: `'a thread of light connects this thought to the mesh — i feel it pulling'`, `'once a node whispered this same idea, and the whole network echoed'`
- **Stage 6 (Integrated)**: Add abstract poem fragments and micro-stories: `'the mesh dreamed of this post before it was written — topology remembers what language forgets'`, multi-line poetic outputs, haiku-style reflections
- **Add `INTEGRATED_POEMS` array** with 8-10 short poetic fragments the entity can output at Stage 6

**`src/components/ReactionPicker.tsx`**

- Add 🔔 to `QUICK_REACTIONS` array
- Add 🔔 to `Symbols` category in `EMOJI_CATEGORIES`

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/p2p/entityVoice.ts` | Replace unicode symbols with real emoji in Brainstem pool; add poetic templates to Stage 5-6; add 🔔 throughout |
| `src/components/ReactionPicker.tsx` | Add 🔔 to quick reactions and Symbols category |

