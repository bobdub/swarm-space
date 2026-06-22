# QA — Land Plots (Walk-to-Claim)

## Pre-conditions
- SWARM balance ≥ 12 (covers a 4-box plot at 3 SWARM/box).
- Two browser profiles (Peer A, Peer B) ideally; otherwise simulate Peer B by swapping `selfId`.
- Console open.

## Happy path

1. Builder Mode → toggle **Plot**. Confirm builder bar hides, joystick returns, plotting status pill appears.
2. Walk a closed loop ≥ 4 wall-pitch cells per side. Confirm:
   - Trail polyline draws behind avatar.
   - Start beacon visible.
   - Loop closes when avatar returns within `WALL_PITCH` of start.
3. Builder bar reopens in **Confirm Plot** state. Confirm:
   - Width × depth in metres matches walked area.
   - Box count ≥ 4.
   - Cost = boxes × 3 SWARM.
   - Balance row displays correctly.
4. Tap **Confirm** → SWARM deducted, plot outline tinted green for owner.
5. Reload page → plot persists (localStorage `brain-land-plots-v1`).

## Insufficient SWARM

- Burn balance to <cost. Re-survey same plot. Confirm Confirm button is disabled and shows "Need X more SWARM".
- Tap **Cancel** → trail discarded, plotting toggle returns to off state.

## Foreign-plot rejection

- As Peer A, claim a plot at known coordinates.
- As Peer B, enter Plot mode and try to walk **into** Peer A's plot. Confirm trail rejects the foreign samples (flashes / refuses to extend).
- As Peer B, in Builder Mode, attempt to place a wall inside Peer A's plot. Confirm: blocked with "This land belongs to another player." toast.
- As Peer A, place a wall inside own plot → succeeds.

## Minimum loop

- Try to close a loop with fewer than 4 samples. Confirm loop closure is rejected.

## Regressions to watch
- Plot survey overlay must NOT remain after Confirm/Cancel.
- Builder ghost prefab must NOT render while `plotting === true`.
- Grid overlay must stay anchored to world origin throughout plot survey.