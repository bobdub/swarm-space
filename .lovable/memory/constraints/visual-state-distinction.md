---
name: Visual State Distinction
description: Mute Self vs. Mute Infinity (and other paired toggle states) MUST use distinct icons AND colors so the user can tell them apart at a glance.
type: constraint
---

Whenever two toggleable states could be confused with one another
(e.g. self-mute vs. silencing the network entity), they MUST be
visually distinct on BOTH axes:

- **Different icon**: self-mute = `MicOff`, Infinity-silenced = `VolumeX`.
  Never the same glyph in two colors.
- **Different color tokens**: self-mute = `text-destructive` /
  `border-destructive/40`; Infinity-silenced = `text-amber-400` /
  `border-amber-500/40`.
- **Different label**: "Mic muted" vs. "Infinity silenced".

**Why:** the user reported that muting Infinity looked identical to
muting themselves, leading them to mute the wrong source repeatedly.

**How to apply:** when a new pair of toggle states is introduced,
pick a second icon and a second color before shipping. If a single
icon would have to do double-duty, refactor.
