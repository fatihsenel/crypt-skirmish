# Turning the view — design

## Why
Rules 12 brought heights and cliffs, and raised ground now hides what lies past it. The view
looks from one corner only (+x, +z), so a fight behind a rise or a wall is hard to read. Turning
the view a quarter at a time lets a player see a fight from all four sides.

## Goals
- Turn the battle view 90° either way, eased over 300 ms (a snap under `calm()`).
- Q turns anticlockwise, E clockwise; a Turn button beside Photo turns clockwise; a two-finger
  twist on a touch screen turns either way; a pad's LT and RT turn.
- Everything that depends on the view direction follows it: wall fading (`tickFade`), the
  brazier light shafts (`haze.js`, which face the camera), the arrow-key cursor (already in
  screen space through `stepTile`), and the camera's own moves (`stairCamera`, `peekFloor`,
  `bossSweep`, `lastBlow`, all relative to where the camera is).
- A new fight starts from the usual corner. Photo mode keeps its free turning and, on leaving,
  restores the turned view it started from.
- The turn is announced to screen readers ("View from the north-west", by the compass the
  camera looks from).

## Non-goals
- No rules change: fights, replays, links and co-op are untouched.
- Wall decor (torches, banners, cobwebs, scars) stays on the walls that face the usual corner;
  from the other sides those walls show their bare backs.
- Figures keep their facing in the world (turning them with the view would make them spin).
  *Changed from the first proposal, which turned them.*
- One Turn button, not two: the phone's top row has no room for a pair. *Changed from the first
  proposal.*

## Approaches
1. **Quarter turns about the point the camera looks at** (picked): the camera orbits
   `controls.target` by ±90° of azimuth; the board reads the view direction from the camera.
   Cheap, and every relative camera move keeps working.
2. Free orbit like photo mode: more freedom, but the isometric framing, the HUD insets and wall
   fading would all have to handle any angle, and touch already uses one finger for picking.
3. Rotate the board's group instead of the camera: breaks the rules-to-world mapping that
   picking, labels, lights and shadows rely on.

## The how
- `stage.turn(dir, { snap })` orbits the camera about `controls.target` (azimuth ±π/2) and
  `stage.view()` returns the camera's ground direction as `{ x: ±1, z: ±1 }`. A new fight calls
  `stage.turnHome()`.
- `board.tickFade` uses that direction: depth is `(w − p) · view`, side is the cross term.
- `haze.js` turns the brazier shafts to the view's yaw.
- Keys in `controls.js`, the twist in `camera.js` (touch events on the canvas, a turn once the
  two fingers' angle passes 35°), LT/RT in `gamepad.js`'s `press`, the button in `index.html`.
- README (controls, Turn button) and CLAUDE.md (the camera section) say so.

## Left to the builder
The button's icon; how the turn eases; the twist threshold within reason.
