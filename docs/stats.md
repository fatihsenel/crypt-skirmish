# Reading the play stats

The deployed game sends anonymous events to Umami Cloud (`src/stats.js`), and counts each one,
with its properties, by day in the loss-replay Worker (`/event`, the `tallies` table; one more,
`visit`, once a page). This page lists them
and how to answer balance questions with them. Look after a week or so: a few dozen runs per
room before trusting a rate, and compare against `npm run sim -- 300`, which assumes a careful
player.

## The events

| Event | When | Properties |
|---|---|---|
| `run-start` | New campaign or New Game+ | `kind` (new, ngplus), `difficulty`, `tier`, `party` |
| `run-continue` | Continue from the title | `room`, `cleared`, `difficulty`, `tier`, `midFight` |
| `run-abandon` | A new campaign replaces an unfinished one | `room`, `cleared`, `difficulty`, `tier` |
| `fight-won` / `fight-lost` | A real fight ends (not `?level=`) | `room`, `mode`, `difficulty`, `tier`, `party`, `rounds`, `standing`, `downed`, `input` |
| `campaign-won` | The Tomb won | `difficulty`, `tier`, `party`, `relics` |
| `visit` | Once a page, when stats are on (counted by the Worker only) | `returning` (true when this browser has saved anything from the game before) |
| `ease-offered` | The Defeat banner offers a lower difficulty (a third loss in the same room) | `room`, `difficulty` |
| `ease-taken` | Try again on Normal or Story pressed | `room`, `from`, `to` |
| `stop` | A choice at a stop | `stop` (pilgrim, altar, reliquary), `choice`, `difficulty` |
| `daily-start` | Play today's or this week's crypt | `mode` (daily, weekly), `room` |
| `replay-watched` | Watch replay | `from` (banner, title, link), `room` |
| `challenge-played` | A `#play=` link opened | `room` |
| `shared` | A share that went through | `what` (replay, challenge, result, run-card, photo), `how` (share, copy, save) |
| `fight-left` | The page closed or reloaded mid-fight (not `?level=` or replays) | `room`, `mode`, `difficulty`, `tier`, `party`, `round`, `standing`, `downed`, `input` |
| `perf` | Once a visit, after about 300 frames of movement on the board | `fps` (50+, 30-50, under 30), `dpr` (the pixel ratio drawn at, to a half) |
| `error` | A crash in the game's own code, up to 3 a visit, each place once | `type` (TypeError, …), `file`, `line`, `col`, `browser` (chrome, safari, firefox, edge, samsung, other) |

`party` is the class letters in hero order: F W R C, with P (Paladin), K (Warlock) and
A (Ranger) in place of their slot's usual class. `mode` is campaign, daily, weekly or challenge.
`standing` counts heroes on their feet at the end; `downed` counts how often any hero dropped.
`input` is what the player pressed most in that fight: touch, mouse, keys (or none).

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

**Do phone players have a harder time?** `fight-lost` by `input` against `fight-won` by
`input`: a much higher loss rate on touch points at the touch controls, not the rooms. `perf`
by `fps`: if a real share draws under 30, the board needs to get cheaper (shadows, pixel ratio).

**Is a room too hard?** `ease-offered` by `room` says where players lose three times running;
`ease-taken` against it, how many would rather go on one step easier.

**Do players come back and share?** `visit` by `returning`; `run-continue` and `daily-start` per day; `shared` by `what`.

## The weekly digest

`npm run digest` prints the last 7 days as a short report from the Worker's tallies (Umami
Cloud's API is for paid plans): visits, runs, each room's won, lost and left fights with its
loss rate (the worst room named once it has 5 fights), crashes by browser and place in the code,
input and frame-rate shares, and the losses stored by the Worker. Each count shows its change from
the week before in brackets, and visits say how many came from players who had played before. It needs the Worker's read key
in the environment, `LOSS_READ_KEY`; without it, or if the Worker refuses it, the report says so.
`npm run digest -- --out week.md` saves it too.

With `UMAMI_API_KEY` (Umami Cloud › Settings › API keys) too, it adds Umami's visitors, visits,
page views and top 5 referrers.

GitHub Actions runs it every Monday at 07:00 UTC (`.github/workflows/digest.yml`; Actions › Weekly
digest › Run workflow runs it now). The keys are repository secrets, set once from the repo (each
asks for the value without showing it):

```
gh secret set LOSS_READ_KEY
gh secret set UMAMI_API_KEY
```

The report is the run's `digest` artifact (kept 30 days), never printed in the log, since the
repository is public; a missing read key, or either key refused, fails the run, and GitHub emails about it. The
tallies are kept 400 days, at most 20,000 events a day and 30 a minute from one address, and
never store an address.

The same numbers, for the last 7 or 30 days (each with its change from the period before), are at the top of
https://fatihsenel.github.io/crypt-skirmish/?losses (Play stats), with the read key that page
keeps; a room's name there filters the lost fights to it.

## Crash alert

Every day at 05:30 UTC GitHub Actions runs `scripts/crash-check.mjs`
(`.github/workflows/crash-check.yml`): it reads yesterday's tallies (`/tallies?day=`) and fails
the run, so GitHub emails, if anyone's game crashed, or if the read key is missing or refused.
The log only says how many; Play stats on `?losses` says in which browser and where in the code.

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
