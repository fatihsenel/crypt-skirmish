# Reading the play stats

The deployed game sends anonymous events to Umami Cloud (`src/stats.js`). This page lists them
and how to answer balance questions with them. Look after a week or so: a few dozen runs per
room before trusting a rate, and compare against `npm run sim -- 300`, which assumes a careful
player.

## The events

| Event | When | Properties |
|---|---|---|
| `run-start` | New campaign or New Game+ | `kind` (new, ngplus), `difficulty`, `tier`, `party` |
| `run-continue` | Continue from the title | `room`, `cleared`, `difficulty`, `tier`, `midFight` |
| `run-abandon` | A new campaign replaces an unfinished one | `room`, `cleared`, `difficulty`, `tier` |
| `fight-won` / `fight-lost` | A real fight ends (not `?level=`) | `room`, `mode`, `difficulty`, `tier`, `party`, `rounds`, `standing`, `downed` |
| `campaign-won` | The Tomb won | `difficulty`, `tier`, `party`, `relics` |
| `stop` | A choice at a stop | `stop` (pilgrim, altar, reliquary), `choice`, `difficulty` |
| `daily-start` | Play today's or this week's crypt | `mode` (daily, weekly), `room` |
| `replay-watched` | Watch replay | `from` (banner, title, link), `room` |
| `challenge-played` | A `#play=` link opened | `room` |
| `shared` | A share that went through | `what` (replay, challenge, result, run-card, photo), `how` (share, copy, save) |
| `fight-left` | The page closed or reloaded mid-fight (not `?level=` or replays) | `room`, `mode`, `difficulty`, `tier`, `party`, `round`, `standing`, `downed` |
| `error` | A crash in the game's own code, up to 3 a visit, each place once | `type` (TypeError, …), `file`, `line`, `col`, `browser` (chrome, safari, firefox, edge, samsung, other) |

`party` is the class letters in hero order: F W R C, with P (Paladin), K (Warlock) and
A (Ranger) in place of their slot's usual class. `mode` is campaign, daily, weekly or challenge.
`standing` counts heroes on their feet at the end; `downed` counts how often any hero dropped.

## Where to look in Umami

- **Realtime:** who is playing now and the events of the last half hour.
- **Events** (the website's page, Events tab): counts per event; open one to break it down by a
  property, e.g. `fight-lost` by `room`.
- **Reports › Insights:** filter and group events by their properties; save the ones below.
- **Reports › Funnel:** steps through events in order.

## Questions and how to answer them

**Which rooms end runs?** Events › `fight-lost` by `room`, filtered to `mode` = campaign. Set it
beside `fight-won` by `room`: a room's loss rate is lost ÷ (won + lost). The sim's per-room
losses (the "lost at" line) are the baseline; a room well above it is harder for people than for
the sim's AI, usually a positioning or targeting trap the sim plays around.

**Is a difficulty tuned right?** The same split, filtered by `difficulty`. Targets: Story nearly
always won, Normal most runs won, Hard about half.

**Do close calls happen, or only stomps and wipes?** `fight-won` by `standing` and `downed`.
Mostly 4 standing with 0 downed means a room is too easy; mostly 1 or 2 standing means it bites.

**How long do fights take?** `fight-won` by `rounds`, per room. Long fights feel slow on a phone.

**Where do people give up?** `run-abandon` by `room`, and runs that never come back: compare
`run-start` with `run-continue` and `campaign-won`. A Funnel of `run-start` → `fight-won`
(room = sanctum) → `fight-won` (room = throne) → `campaign-won` shows the drop between acts.

**Do the stops work?** `stop` by `stop` and `choice`. If nearly everyone robs the pilgrim, tending
him pays too little; if nobody offers at the altar, the blessing isn't worth the blood.

**Are classes balanced?** `fight-lost` by `party` against `run-start` by `party`. A swap that
loses more often than the base party (FWRC) is weaker in people's hands.

**Where do people give up mid-fight?** `fight-left` by `room`, beside `fight-lost`. A room
left far more often than it's lost frustrates people before it beats them: look at `round` (left
at round 1 is a bad start or a slow load; late is a slog) and `standing`. A reload of a campaign
fight picks it up again: `run-continue` with `midFight` counts those who came back.

**Does it break somewhere?** `error` by `browser`, then by `file`, `line` and `col`. One
browser alone means a compatibility bug; every browser, a plain bug. The built file's name
(`index-Dk6rnk2i.js`) names its deploy: the deploy's log prints it (`gh run view <id> --log | grep
index-`). Build that commit with `npx vite build --sourcemap` and look the line and column up in
the `.map` (DevTools or any source-map tool) to find the code. On the dev server the file and
line are the source's own.

**Do players come back and share?** `run-continue` and `daily-start` per day; `shared` by `what`.

## Watching the losses

The rates say which room; the replays say why. Open the game with `?losses`
(https://fatihsenel.github.io/crypt-skirmish/?losses) and give the read key once. Where they
fall, at the top, counts each room's losses in the last 7 and 30 days by difficulty, the most
first (set Mode to Campaign for runs only). Click the room that stands out and watch a few: where the party stood, what killed them first, whether
they used what they had. A fight recorded before a rules change shows "Older version".

## Acting on it

Change one thing at a time (a monster's HP, a room's map, a stop's price), run
`npm run sim -- 300` to see that the sim agrees, and say what changed in the commit message so
the next week's numbers can be read against it. Fight records from old saves and links stop
replaying when the dice order changes (see CLAUDE.md).
