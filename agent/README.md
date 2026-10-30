# Koehandel bots

**If you are an agent picking this up: read this whole file before you change or run anything.** It is kept short on
purpose: where things are, what the bots are now, how to test a change, the lessons that cost the most to learn,
and the open work. `LOG.md` next to it is the lab notebook (every round in full, with every number); look things up
there when you need the details of one experiment, but you do not need to read it first.

The bots live in `lib/bots/` and run on the server. This folder holds the research behind them: scripts, the C++
simulator, results and the network training.

## 1. Where things are

| Path | What |
|---|---|
| `lib/bots/index.js` | The levels (`LEVELS`), **Insane's settings (`INSANE`, with a comment per setting)**, live bidding and thinking times, `botBid`/`botMove` |
| `lib/bots/expert.js` | Every decision (`expertAgent`): bid limit and opening bid (`bidPlan`), buy-back, turn choice, koehandel offer/counter, money estimates (`look`), deck-size blend (`forDeck`), personalities (`styleOf`) |
| `lib/bots/brain.js` | What a bot may see (`observe`) and the position model (`Model.util`: the soft chance to win) |
| `lib/bots/solver.js` | The koehandel as a hidden-hand game, solved by fictitious play (Insane) |
| `lib/bots/tracker.js` | Card tracker: guesses of every hand followed through every public event |
| `lib/bots/value.js`, `net*.js`, `nets.js` | The learned position model (`th.net`), blended with the formula (`netMix`) |
| `lib/bots/insane.js`, `policies.js`, `levels.js`, `sim.js` | First-generation bots (benchmarks only), agent factory, fast self-play helpers |
| `lib/engine.js` | Rules, timers, live bot bidding (`botCaps`: a bot's limit is fixed when the auction opens), the history the bots read (`s.hist`) |
| `app/api/game/route.js`, `app/page.js`, `app/local.py` | Server (logs every game to `games/`), page (polling), local server |
| `agent/cpp/` | C++ port of engine + bots for long runs: `gauntlet`, `tune5` (CMA-ES), `sprt`, `movelog` + `check.sh` (JS = C++ move for move), `datagen`, `audit`; `build.sh` |
| `agent/scripts/` | JS tools; the ones that matter now are listed in section 3 |
| `agent/runs/` | Results (`*.txt`), the commands that made them (`*.sh`), tune logs (`*.jsonl`), **named variants and opponents (`specs2.json`)** |
| `agent/value/` | Network training (`train.py`, `export.mjs`, `check.mjs`, `register.mjs`); data in `agent/value/data` (not in git) |
| `games/` | Logged games, hidden cards included (gitignored; local server writes them, `scripts/fetchlogs.mjs` gets hosted ones) |

Named opponents (`scripts/registry.mjs`, `runs/specs2.json`): `hard`, `insane` (the levels), `shark` (sharp-human
stand-in), `novice`, `person` (rough stand-in for people: bold offers, accepts 35%; far too weak), counter-strategies
found by search against Insane: `xB` (seller/hoarder, 20 cards), `x6`/`x7` (low / keen bidders, 20 cards), `x8`
(low bidder, 40 cards), **`x9` (money hoarder, 40 cards: Insane's weakest table)**; frozen earlier Insanes `ins4`,
`ins7`, `ins8`, `insB`. A spec can change settings: `insane:softCap=1,mDec=0.2`, `insane:small.shade=1.2` (20-card
value), `x9:person=1` (seat counts as a person), `vs:x9` (in a tune field: x9 alone against the candidate).

## 2. The bots now

| Level | What it is |
|---|---|
| Easy | Hard's judgement with beginner habits (takes offers at face value, never bluffs, bids timidly, blurred prices), calibrated to a novice stand-in |
| Medium | Hard's judgement, prices blurred (sd 0.2), 6% careless turns; rates halfway between Easy and Hard |
| Hard | Predicts every other player from their side of the table (bid limits, buy-backs, koehandel answers) and picks the best move against that. Deliberately left beatable: do not change it |
| Insane | Hard + the koehandel solver + recalibrated money value + card tracker + habit reading + opening bids + a fifth of a learned position model + settings of its own for 20-card decks and for tables of people |

**How Insane decides.** Every decision compares `Model.util` (its soft chance to win) after each option. The model,
per animal type: strength = (held + rho × still to come / players)^gamma × (money + mu)^delta; set chances follow,
then each player's expected score, then win chance = softmax of expected scores (temperature tau). With 40 cards a
learned network contributes 20% (`net: 2, netMix: 0.2, netT: 2.17`); with 20 cards half (`net: 3`).

- **Auctions:** an English auction. Its limit is the highest price at which being the highest bidder still beats a
  rival being it, both counting the auctioneer's buy-back as a chance (`softCap`); ×`shade` (1.04). It may open high where a bid of 10 would
  let the auctioneer buy back for nothing (`open`, `openHist`: by what that auctioneer actually did). Live, the
  limit is fixed when the auction opens and the bot raises in small steps.
- **Buy-back:** only if buying back beats selling by a margin of `mDec` (10.4%, relative). Insane rarely buys back,
  and people notice; every way of lowering the margin found so far loses against hoarders (section 4).
- **Turn:** auction (value: every animal that can come up, predicted prices) or a koehandel (value: a rough solve).
  At 40 cards `khBias -0.6` multiplies a koehandel's value by 0.4, so **Insane never starts a koehandel while cards
  are left**; once the deck is empty it must, and picks the best.
- **Koehandel:** solved as a hidden-hand game (13 sampled hands per side, 80 rounds of fictitious play), hands
  guessed by the card tracker; `allIn`: when the result can no longer matter to its own money, it puts everything in;
  `capSure`: a counter never goes above what surely beats the attacker's whole money (estimate + 3 sds).
- **Tables of people:** live seats know who is a person; `khBiasP` (koehandel restraint against a person: -0.6 at 40
  cards, 0 at 20), the tracker's prior for bold offers. `th.solo` exists for "all others are people" but is empty.
- **Deck size:** `th.small` holds the 20-card values, blended in between 30 and 20 cards (`forDeck`).

**Benchmark (40 cards, 3 players, Insane against two of each; fair = 1, the maximum is 3; 100 deals, ±0.08;
`runs/human3.txt`; "Insane" = the Insane before the tenth round):**

| x9 | x8 | Hard | xB | shark | Insane (before) | Hard as a person | `person` |
|---|---|---|---|---|---|---|---|
| 0.81 | 1.14 | 2.09 | 2.11 | 2.74 | 1.08 | 2.13 | 2.90 |

One alone against two Insanes (lower is better; 150 deals): x9 1.16, x8 0.73, Hard 0.18, xB 0.53. 20 cards: x6
1.92, x7 1.80, Hard 2.41, shark 2.16, xB 2.04, `person` 2.63. Regression check over every table shape (3-5 players,
20-40 cards) is clean (`runs/regress10.txt` against `runs/regress.txt` before the tenth round), with one trade: at 25
cards `softCap` costs a little against `ins8` (0.86 against 0.97 on 200 deals; Hard 2.25 against 2.07, xB 1.65
against 1.74). Hard against two Insanes at 20 cards: 0.67, so the step to Insane is real.

## 3. How to work

**Measure with duplicate deals in C++.** Every number above is win share × players over duplicate deals (each deal
played with the candidate in every seat, the same deals for every candidate):

```bash
sh agent/cpp/build.sh gauntlet movelog                        # after any C++ change (a running exe is moved aside, not broken)
./agent/cpp/gauntlet.exe "insane:softCap=1" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 100 3 40   # the general field
sh agent/cpp/check.sh "insane:softCap=1;hard;xB" 40 61 2      # JS and C++ must print "same" after every port
sh agent/runs/regress.sh > agent/runs/regress.txt             # every table shape, before adopting anything
FIT=soft:0.1 DEALS=24 LAMBDA=10 SIGMA=0.25 START="k=v,..." ./agent/cpp/tune5.exe <name> <gens> insane "<field>" 40 3 "k:lo:hi,..."
```

- Spec overrides are **comma-separated**: `hard:shade=2,person=1`. A second colon used to drop the rest silently
  (it voided a round-11 test); both registries now refuse it.
- Noise: ±0.08 at 100 deals, ±0.05-0.07 at 150. A difference under ~0.1 on one table is nothing. The gauntlet's
  seed is fixed, so two candidates see the same deals and differences between them are cleaner than ± says.
- **The target is tables of people** (the owner, round 11): live tables are mostly people with one or two bots
  (2 people + 1 Insane, 2/2, 3/1, 3/2), and people rarely hoard; they spend, go broke and collect money again. The
  main benchmark is `runs/people.sh` (one Insane against a mixed field of person-marked stand-ins at 3-5 players).
  The **general field** (x9, x8, Hard, xB, shark, the current Insane) is the check for bot tables; a change that wins
  against people but loses against hoarders goes into a person-only setting (live seats know who is a person, as
  `khBiasP`). Never trade people-table strength for hoarder strength. Pushers and gangs are out of scope.
- Adopt a change only if it is level or better on every table of the field (or the owner agrees to a trade), then
  run the regression check, then put the value in `INSANE`.
- One CPU-heavy job at a time. Read the first output of every long job (a tune showing all gains 0.00 is broken).
  Anything over ~3 minutes runs in C++; Python only for analysis and training; the live bots are JS.
- New decision code: prototype in C++ behind an off-by-default setting (`agent/cpp/common.h` ThKey + `expert.h`),
  test, **delete it if flat**; only then port to JS and make `check.sh` say "same". JS is the reference.

**Look at games before tuning.** The tools that found every real problem:

```bash
node agent/scripts/explain.mjs games/<file>.json [3,20]       # a logged game rebuilt move by move: every bot's limit, buy-back, turn options, counter; events in depth
agent/kh new; agent/kh b 60 -- why                            # play against 3 Insanes, one decision per call, no clocks (for an LLM subagent; saved as games/llm-*.json)
EXTRA='{"softCap":1}' node agent/scripts/explain.mjs games/<file>.json   # the same game with other Insane settings
node agent/scripts/replay.mjs games/<file>.json               # a logged game as a story with everyone's real money
WHY=1 node agent/scripts/rebuild.mjs games/<file>.json        # older replay tool (tracker traces, COUNTER=, TRACK=)
./agent/cpp/movelog.exe "insane;x9;x9" 40 1001 150 > log.txt; node agent/scripts/flows.mjs log.txt   # who wins what, at what price
node agent/scripts/whyoffer.mjs "insane;x9;x9" 1001 4         # why Insane's endgame offers look the way they do
node agent/scripts/golden.mjs insane 3                        # hash of every move: a pure speed-up must not change it
```

## 4. Lessons learned

These cost the most time to learn. Read them before planning anything.

1. **Look at games first, then form a mechanism, then test one knob for ~20 minutes, and only then tune.** Every
   real gain came from reading move logs or replaying a person's game (the hoarder endgame, sharp guesses, the
   all-in, opening bids by history, the broken bid limits). Blind sweeps and multi-hour tunes of the same knobs came
   back flat again and again (net5, t13, ARCH=c, TD(lambda), khBiasL/A, priceK, adapt).
2. **Trace a decision before choosing the direction of a fix.** "Money is overvalued at hoarder tables" was the
   obvious guess and wrong: Insane arrives at the endgame *poorer* (807 against ~1,000 each) and loses the forced
   fights. Verify a metric's definition (stage by cards drawn, not by event index) before writing a conclusion.
3. **The money fight at the end decides 40-card games against strong players.** Once the deck is empty everyone
   must koehandel and the richest wins the split sets. Hoarders (x8, x9, and people who sell and wait) keep their
   money through the auctions. Anything that hands an opponent money (a cheap buy-back, an overpaid counter, a
   keen bid that the auctioneer cashes) shows up as a loss against x8/x9 even when it looks free. That is why the
   buy-back margin survives every attempt to soften it (`mDecP`, `mDecW`), and why `deltaEnd` (money weighed more
   late) helps against hoarders.
4. **Bots only test the holes someone thought of.** Counter-strategy search (CMA-ES for one opponent whose only
   goal is beating two Insanes) found x6, x8 and x9, each a style a person could play; the person stand-in is far
   too weak (Insane wins ~96% against it) and says little. Real games against people found the visible blunders.
5. **Who else sits at the table changes the best play.** Two Insanes drive each other's prices up for the third
   player (a prisoner's dilemma: the auctioneer's gain is the same whichever bot wins). Settings tuned with two
   Insanes at the table (koehandel restraint, keenness following) can be wrong for one Insane against two people.
   Test both "Insane against two of X" and "X against two Insanes".
6. **The evaluation is at the luck floor.** Three different network changes all ended at the same log loss
   (0.769); a wider network does not predict better. Gains now come from decisions, not from the evaluation. A new
   evaluation must get its decision settings retuned before it can be judged (t9).
7. **Fitness must not let a gain on one table buy a loss on another.** Use the soft minimum (`FIT=soft:0.1`) over a
   field of tables, verify on 150 new deals, and adopt only what is level or better everywhere. A tune with too few
   deals per entry overfits (t8 traded x8 for Hard and xB).
8. **The model's win chance is too flat** (a hopeless player still sees 15-16%). Calibrating it made decisions worse
   (it works as a cautious utility), but it causes kingmaking near the end: a player that cannot win moves money
   between the others. Handle that at the decision (e.g. `capSure`), not by changing the utility (`own` loses
   against hoarders at 40 cards).
9. **A bid limit search that stops at the first failing price is fragile** when the comparison is not monotonic
   (yes/no buy-back predictions): limits of 20 for a cow worth 200 to the bot. Predicting buy-backs as a probability
   (`softCap`) makes it smooth.
10. **Correctness first.** JS and C++ must play move for move (`check.sh`) after every port; a silently missing patch
    (ARCH=c) and a spec-parsing bug in the tuner (a second `:` cut a spec; every gain 0) each wasted hours. After a
    patch, grep that it landed.
11. **Process.** No speculative code (four off-by-default settings in JS + C++ + tests, all removed again); delete a
    flat prototype at once; never stack CPU jobs (a BelowNormal sweep next to a Normal tune got almost no CPU for
    hours); never commit or push unless the owner asks; never send the owner's email anywhere; keep Redis/API calls
    low (the page polls fast only during bidding).

## 5. Open work, by expected value

1. **`deltaEnd` / `deltaPoor` (money weighed more as the deck runs out).** deltaEnd 1.35-2.2 gains a lot against
   hoarders and head to head (x9 0.77 → 0.99-1.19, Insane 1.10-1.22) but costs against Hard/xB/shark (Insane is
   already the richest at those tables, so it under-buys); `deltaPoor 1.35` (the late weight only while poorer than
   the richest other: x9 0.88, x8 1.43, Hard 2.04, xB 2.08, shark 2.72, Insane 1.14; `runs/poor.txt`) keeps most of
   it without the costs but needs a 150-deal confirmation (1.2 / 1.35 / 1.5 beside it). C++ only so far; JS port is
   ~6 lines in `Model`'s constructor (mirror `agent/cpp/brain.h`).
2. **Koehandels during the deck phase.** `khBias -0.6` means none at all at 40 cards. Against bots that was tuned as
   best, but it misses sure steals against broke players (the owner: "going broke in the auctions is an easy way to
   collect cards if nobody koehandels you"). Round 11 (two LLM games, `games/llm-*.json`): before the bias, Insane
   rated a koehandel above the auction 13 times in 80 deck turns, all by small margins (Barnaby stealing a cow from
   a player with 70: 24.2% against an auction's 23.6%). And a spender stand-in (Hard bidding 2× its limit) against two
   Insanes scores the same 0.22 with khBiasP -0.6, -0.3 or 0 (`runs/spend.txt`): the restraint is not what stops
   these steals, **the model's koehandel value is too low**. Look there first (why a sure steal is worth so little;
   how the auction's value compares), then: no restraint when the defender cannot counter; restraint by how well
   that player answered koehandels so far.
3. **The endgame.** A small search over the remaining forced koehandels (who can afford which fight) instead of a
   money exponent; and knowing when a player is mathematically out (its best possible score below another's sure
   score), which the soft win chance does not.
4. **`solo` settings** (one Insane against two people, the real use): run t11 was stopped after 3 generations; its
   centre had a better worst case but was worse against Hard. Resume from its centre (command in `LOG.md`, "What the
   stopped runs left"), tuned on person-marked tables only.
5. **More real games.** Every person's game found something. Analyse each new log with `explain.mjs`; fit the
   tracker's prior for people (BOLDH/BOLDAT) on them; build better people stand-ins from them.
6. Small: record the `golden.mjs` hash after each adopted change; the ninth-round C++-only stand-ins (`gang`, `push`)
   and prototypes (`deltaPoor`, `paranoid`) are still in `agent/cpp`; delete `paranoid` if not used.

## 6. History in brief

- **Round 1 (first generation).** A small position model with 17 parameters tuned by self-play (sep-CMA-ES, staged
  fields); Insane = Hard + determinized Monte Carlo playouts (16 worlds, 16 moves deep: depth mattered most).
  Self-play learned habits that only work against copies of itself.
- **Rounds 2-3 (second/third generation, `expert.js`).** Every decision predicts the others from their side of the
  table; Insane got the koehandel solver; money was overvalued (delta 0.86 → 0.6, the one loss to hard0 became a
  win); levels recalibrated; personalities per seat. A learned evaluation predicted better but played worse.
- **Round 4 (a game against people, 20 cards).** Sharp hand guesses (the money was known but not used), padding costs,
  the last-stand all-in, the money offset scaled to the money in play (`muScale`), opening bids.
- **Round 5 (other kinds of players).** Opening bids by the auctioneer's history (`openHist`), money weighed more late
  (`muEnd`, `deltaEnd`), 20-card settings tuned separately (`th.small`), the first counter-strategy (`xB`), a finer
  turn choice and the card tracker at 20 cards.
- **Round 6 (a person against two Insanes, 20 cards).** Kingmaking (`own`) and cheap buy-backs (`mDecP`) fixed for 20
  cards only (they cost at 40).
- **Round 7 (calibration, league).** The win chance is too flat but calibrating it plays worse; counter-strategies
  x6/x7 and retunes; x8 at 40 cards; tracker fixes; a regret audit; the C++ solver.
- **Round 8 (40 cards).** Tracker at 40 cards; a learned position model (20 cards: half; 40 cards: a fifth, with its
  own settings from t9 and koehandel restraint); habit reading of acceptors; settings for people (`khBiasP`);
  the hoarder x9 found. Much compute spent on networks and retunes for nothing (lessons 1, 6).
- **Round 9 (what people might do).** Price-pushers and gangs as C++ stand-ins: big holes, but judged out of scope.
  Found on the way: `deltaEnd`/`deltaPoor` (open work 2).
- **Round 10 (a person's 40-card game against two Insanes, `explain.mjs`).** Broken bid limits (cow limit 20 with a
  value of 200: lesson 9, `softCap`), refused cheap buy-backs (the margin; lowering it feeds hoarders: lesson 3),
  kingmaking at the end (Gus countered 1,410 where 500 surely won; `capSure`), live bids shown late (the page now
  polls every 0.5 s during bidding). **Adopted: `softCap`, `capSure`** (level or better on every table). Rejected: `mDecP`, `own`, `mDecW` (margin by the bidder's money), `capScan` (a
  limit search fix, level; `softCap` does the same and better). Results: `runs/human1-3.txt`.
- **Round 11 (LLM players, `agent/kh`).** Sonnet and Opus each played three Insanes and lost (7 and 5 sets for the
  winning Insane). No bot started a koehandel while cards were left; the restraint is not the cause (open work 2).
