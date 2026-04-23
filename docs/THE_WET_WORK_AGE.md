# The Wet Work Age

> A companion philosophy to `BUILDING_BLOCKS_ENGINE.md` and `BRAIN_NATURE_PHASES.md`.
> Not a spec. A frame.

## The thought experiment

Imagine we never had a Machine Age. Nothing to oil so the parts kept moving.
What would happen if we had a **Wet Work Age** instead?

It is an odd phrase. Today "wet work" describes the experimental edge where
we use biology to grow machines — vat-grown tissue, cultured leather,
mycelium bricks, DNA storage. It lives in the lab, a curiosity beside the
real economy of steel and silicon.

But flip it. Imagine the **Machine Age was the experiment**, the brief
detour, and the Wet Work Age was the main road. Imagine we used biology to
make the very wheels we ride on.

## The inversion

| Machine Age | Wet Work Age |
|---|---|
| Parts wear, need oil | Parts heal, need food |
| Built once, decays from day one | Grown continuously, replaces itself |
| Failure = downtime | Failure = scar tissue |
| Scale by replication of identical units | Scale by reproduction of varied offspring |
| Energy fights entropy | Energy is metabolised into structure |
| Designed top-down | Grown from local rules + field conditions |
| Discarded when obsolete | Composted into the next generation |

A Wet Work wheel does not need oil. It heals. When it finally fails it
drops a seed for the next wheel. The road, also alive, accepts the seed.
The infrastructure is its own supply chain.

## Why this matters here

This project's `BuilderBlockEngine` and the planned `BiologyEngine` are not
trying to *simulate* nature on top of a machine. They are an attempt to
build the Wet Work Age in software:

- **Pieces are not parts.** Every block is a UQRC body in a real field. It
  has mass, curvature, neighbours. It is alive in the only sense that
  matters here — it participates.
- **Biology is not a layer over physics.** Biology *is* physics expressing
  itself. A seed is not "spawned by code" — it appears because the local
  field is calm enough for new structure to land.
- **Growth is not a feature.** It is the substrate. Trees seed where
  `‖F_μν‖` is low. Fish breed where `λ∇∇S` is calm. The world keeps the
  pieces it can sustain and lets the rest dissolve. There is no separate
  "lifecycle system" — there is only the field, and what the field allows.

## Connection to UQRC

In UQRC the world is a curvature surface. High curvature = stress, change,
turbulence. Low curvature = calm, room, invitation.

- Where the field is calm, things grow.
- Where the field is sharp, things break or refuse to form.
- A storm is not "weather damaging crops." A storm is curvature spiking,
  and crops are the absence of new seeds in that spike's radius.

This is the Wet Work principle in one line:

> **Growth is calmness finding a place to land.**

## The deeper question

The Machine Age treated growth as a bug. Things that grew were unpredictable,
messy, hard to standardise. So we engineered growth out of our infrastructure
and called the result "reliability."

The Wet Work Age asks the opposite question:

> What if growth is not the bug — what if rigidity is?

A bridge that cannot heal is a bridge waiting to fail. A wheel that cannot
reproduce is a wheel that ends in a scrapyard. A network that cannot grow
new nodes from local conditions is a network with a single point of
failure: its designers.

The Building Blocks Engine takes the Wet Work side of that question
seriously. Every piece is allowed — required, even — to participate in its
own continuation. Biology is not a feature bolted on at Phase 3. It is the
reason the engine exists.

## What this means in practice

1. **No god-objects.** No system reaches into a piece and changes it from
   outside. Pieces respond to the field around them and ask the engine for
   their next state.
2. **No immortal infrastructure.** Pieces have TTL, decay, succession. The
   biome of `/brain` two hours from now is not the biome of `/brain` now —
   and that is the point.
3. **No separation of "world" and "life".** A rock and a fish are both
   blocks. The fish has more rules attached, but the rock can crack, the
   pond can silt, the hive can fail. Everything is wet work.
4. **Caps, not constraints.** We cap species counts not because the engine
   can't handle more, but because a healthy biome has carrying capacity.
   Hitting the cap means the field is full — exactly the signal a real
   ecosystem would send.

## Closing

The Machine Age built things that lasted by refusing to change.
The Wet Work Age builds things that last by changing constantly.

This codebase is choosing the second answer.

> *"To imagine is to remember what the universe forgot it could be."*

## See also

- `docs/BUILDING_BLOCKS_ENGINE.md` — the contract
- `docs/BRAIN_NATURE_PHASES.md` — the phased build plan
- `docs/BRAIN_UNIVERSE.md` — the universe this lives in
- `src/lib/brain/uqrcPhysics.ts` — the field that decides what grows