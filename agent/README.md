# Koehandel bots: how they were built

This folder holds the research behind the bots you can add to a table: the training and evaluation scripts, the
raw results and the charts. The bots themselves live in `lib/bots/` and run on the server (none of it ships to
the browser). This page is for whoever works on them next.

## >>> PICK UP HERE (state on 2026-10-24, end of the eighth round) <<<

**Read this first.** The eighth round was stopped mid-flight. Below: what was left running and what it means, what
was cancelled or never started (with the exact commands), and the most promising leads, best first. Details of each
item are in "Eighth round" further down. Long runs go in C++ (`agent/cpp`, see "C++ simulator"); `sh
agent/cpp/build.sh <program>` rebuilds one program.

### What the stopped runs left (the round was stopped to wrap up; nothing is running)

- **`runs/t11.jsonl`: the `solo` settings** (one Insane against two people, the final test), **stopped after 3 of 14
  generations** (the first lines are an earlier start, before x9 was in the field; the run that counts starts at
  the second `"gen":0`). Its last centre: `solo.khBiasP=-0.244, solo.shade=1.34, solo.shadeK=0.282, solo.mDec=0.139,
  solo.netMix=0.554, solo.netT=3.55, solo.delta=0.3`, gains on 24 deals per table over plain Insane (then still with
  shadeK -1) of 0.71 / 0.25 / 0.29 / -0.06 / 0.46 / 0.50 against x8, Hard, xB, `person`, `ins8`, x9 (all marked
  as people). **Checked on 150 new deals** (all opponents marked as people; current Insane in brackets): x9 0.97
  (0.64), x8 1.32 (1.16), Hard 1.93 (2.14), xB 2.10 (1.94), `person` 2.83 (2.93), `ins8` 1.65 (1.17): a much better
  worst case but worse against Hard and the weak stand-in, so **not adopted**; it is the strongest lead (its
  koehandel restraint against people, -0.24, sits between the two values tried, see khBiasP). **Resume the tune** (it starts again from
  that centre): `FIT=soft:0.1 DEALS=24 LAMBDA=10 SIGMA=0.25 SEED=13 START="solo.khBiasP=-0.244,solo.shade=1.34,
  solo.shadeK=0.282,solo.mDec=0.139,solo.netMix=0.554,solo.netT=3.55,solo.delta=0.3" ./agent/cpp/tune5.exe t11b 12
  insane "x8:person=1;hard:person=1;xB:person=1;person;ins8:person=1;x9:person=1" 40 3 "solo.khBiasP:-0.6:0.4,
  solo.shade:0.5:1.6,solo.shadeK:-1:1,solo.mDec:0:0.3,solo.netMix:0.1:1,solo.netT:0.5:4:log,solo.delta:0.3:1.5"`,
  then verify on 150 new deals and put the values in `INSANE.solo` in `lib/bots/index.js` if level or better.
- **`net5` was never saved**: its training (d40a-c plus the first 27,500 games of d40d, `HALF=1`) was stopped before
  the end. **Redo it** with the full chain: `ARCH=b EPOCHS=25 HALF=1 OUT=agent/value/net_b5.json python
  agent/value/train.py agent/value/data/d40a.bin agent/value/data/d40b.bin agent/value/data/d40c.bin
  agent/value/data/d40d.bin`, `node agent/value/export.mjs agent/value/net_b5.json 5`, `node
  agent/value/register.mjs 5 "<note>"`, `node agent/value/check.mjs agent/value/net_b5.json
  agent/value/data/test.bin`, then `./agent/cpp/gauntlet.exe "insane:net=5" "x8;x9;hard;shark;xB;insane" 150 3 40`
  and the other side; retune netMix/netT for it before switching `net: 2` to 5.
- **`data/d40d.bin`**: stopped at about 29,800 of 40,000 games (1,761,700 rows; n2 and random personalities in the
  pool, first seed 500001). Usable as it is (train.py drops a half-written last row). The rest, if wanted: first
  seed 540001 into `d40d2.bin`: `./agent/cpp/datagen.exe "n2:3;insane:2;insane:style=2:1;hard:2;hard:style=3:2;
  shark:2;xB:2;x8:2;x7;novice:2;medium:2;medium:style=3:1" 10200 3 40 agent/value/data/d40d2.bin 540001`.
- **`runs/audit40p.jsonl`: regret audit**, Insane against two `person`s, 24 playouts per option, every 2nd decision,
  465 decisions from about 28 games (stopped near the end; `node agent/scripts/audit.mjs --sum
  agent/runs/audit40p.jsonl`). Clearly wrong turn choices: early 5%, **mid 12%, late 9%**, deck empty 2%; buy-backs
  none. Nearly every clearly wrong choice was **an auction where a koehandel was better** (it ran with the bot-table
  restraint khBias -0.6 against the persons, which `khBiasP: 0` has since removed). The mid- and late-deck numbers
  say the restraint may be too strong for bot tables too: **retune khBias by stage of the deck** (a value for early,
  and one for mid/late) in t12.
- **`shadeK` 0** (from the t9 value -1): **done**, see the eighth round.

### Final benchmark (end of the eighth round, 150 deals, ±0.02-0.07)

The finished Insane (`lib/bots/index.js` as it is now), against two of each (fair = 1) and, below, one of each alone
against two of it (lower is better); in brackets the start of the round (the third-round full-deck settings with the
tracker; for x9 the previous Insane `ins8`):

| 40 cards | x9 | x8 | Hard | shark | xB | `ins8` (previous Insane) | `person` | person + Hard |
|---|---|---|---|---|---|---|---|---|
| Insane against two | 0.77 (0.14) | 1.18 (0.66) | 2.12 (2.09) | 2.63 (2.21) | 2.09 (1.77) | 1.84 | 2.93 | 2.32 |
| one alone against two Insanes | 1.16 | 0.73 (2.44) | 0.18 (0.21) | | 0.53 (0.58) | | | |

20 cards (no change this round apart from accept-habit learning and no koehandel restraint against people, which the
benchmark's bots are not): x6 1.92, x7 1.80, Hard 2.41, shark 2.16, xB 2.04, `person` 2.63. These ran with
`khBiasP` 0 against people at both sizes (the final 40-card value -0.6 only matters against people).
Weakest spots: the hoarders (x9 0.77; one x9 alone against two Insanes 1.16), see the leads.

### Cancelled or never started: **do these next**

1. **Retune the settings for tables with other bots, with `x9` in the field** (never started; call it t12). The
   current values (t9) were tuned before `x9` existed and before `solo`; shadeK -1 is a leak against hoarders.
   `FIT=soft:0.1 DEALS=24 LAMBDA=10 SIGMA=0.25 ./agent/cpp/tune5.exe t12 14 insane
   "x8;x9;hard;shark;xB;insane;vs:x8;vs:x9;vs:hard;vs:xB" 40 3
   "shade:0.7:1.6,khBias:-0.6:0.3,mDec:0:0.3,netMix:0.1:1,netT:0.5:4:log,shadeK:-1:1"`
2. **The next data round with `x9` in the pool** (cancelled before it started):
   `./agent/cpp/datagen.exe "insane:3;ins8:2;insane:style=2:1;x9:3;hard:2;hard:style=3:2;shark:2;xB:2;x8:2;x7;novice:2;medium:2;medium:style=3:1" 40000 3 40 agent/value/data/d40e.bin 600001`
   (run it at low priority if anything else runs: `cmd //c "start /LOW /B /WAIT ..."`). Then train on
   d40a-e (`ARCH=b EPOCHS=25 HALF=1 OUT=agent/value/net_b6.json python agent/value/train.py <files>`, export as 6
   with `agent/value/export.mjs`, list it with `node agent/value/register.mjs 6 "<note>"`), check it
   (`node agent/value/check.mjs`), retune netMix/netT, verify.
3. **The next counter-strategy search** against whatever Insane is after 1 and the solo adoption (`vs:insane`, from
   `ins8`, ranges as in `runs/x9.jsonl`); the x9 search was **stopped after 7 of 16 generations** once its centre
   had settled. Every search so far found a hoarder-like hole (x8, then x9): keep the league going until one
   comes back below fair.
4. **The rival-money network (`ARCH=c`)**: **the first comparison was invalid** (the patch to train.py had silently
   not landed, so it trained `ARCH=a`). It is now in train.py, value.js and brain.h, and the JS matches PyTorch
   (4e-9); **the C++ is not yet checked against the JS for arch c** (needs an arch c net in nets.js and
   `sh agent/cpp/check.sh "insane:net=<id>;hard;shark" 40 1 2`). Train and compare with
   `ARCH=c EPOCHS=20 OUT=... python agent/value/train.py agent/value/data/d40c.bin` against `ARCH=b` (0.7876).
5. **20 cards**: the retune of the 20-card network's decision settings (`runs/t10.jsonl`) was **stopped after 4
   generations without a gain** over the current values; leave it unless 20 cards matter again. A 20-card `solo`
   (`solo` currently applies at every deck size) was never tuned.
6. Record the new `scripts/golden.mjs` hash (play changed several times this round).

### The most promising leads

1. **Settings that depend on who sits at the table** (`th.solo`, `khBiasP`, `person` marks). The biggest finding of
   the round: several settings (khBias, shadeK) were good for tables with two Insanes and bad for one Insane against
   two others, which is the final test. Tune `solo` on person-marked tables, the rest on bot tables.
   **Koehandel restraint by how well the other answers**: no restraint pays against weak players and costs a lot
   against strong ones (khBiasP above). Every koehandel's outcome is public (who won, card counts), so the
   restraint could follow how each player's past koehandels went for their attackers, as `habitsAll` does for
   accepting; with too few deals, fall back to the full restraint.
2. **Closing the hoarder hole** (`x9`): shadeK 0, the solo tune, and x9 in the data and in every field.
3. **The AlphaZero loop**: each round put the newest bots in the data; a wider network did not predict better, so
   more and more varied games are the lever, then a retune of the decision settings for every new network (t9
   showed a new evaluation looks worse than it is until its settings are retuned).
4. **Better stand-ins for people**: `person` (Hard + bold offers + accepting 35% + noise) is far too weak (Insane
   wins 95%); the logs of real games (`games/`) show people counter just below the bots' offers and accept about 40%.

## Summary

| Level | What it is | Rating (3-5 players / 3 players) | Win share (fair = 1) |
|---|---|---|---|
| Random | uniformly random legal moves | 0 / 0 (the anchor) | 0.01 |
| Confusing | sensible play with chaotic generosity (see below) | 257 / 474 | 0.23 |
| Easy | the second-generation judgement with beginner habits, calibrated to a novice player | 261 / 554 (novice stand-in: 269 / 537) | 0.44 (novice 0.22) |
| Medium | the same judgement played imprecisely, halfway between Easy and Hard | 419 / 622 | 1.06 |
| Hard | the second-generation judgement: predicts everyone else's moves | 642 / 962 (first-generation Hard: 541 / 858) | 2.12 (first-generation Hard 1.54) |
| Insane | Hard + a game-theoretic koehandel solver + recalibrated model + reading habits + opening bids and money tracking (fourth round) + settings of its own for 20-card games, opening bids that go by what the auctioneer did, a better turn choice (fifth round) + a card tracker and a learned position model blended with the formula, settings that depend on whether the others are people (eighth round) | 665 / 1018 (before the fourth round) | 2.26; at 3 players with 20 cards against two Hards 2.41, two sharks 2.15, the counter-strategies `xB` 2.05, x6 1.96; with 40 cards against two Hards 2.11, two sharks 2.52, `xB` 2.06, the previous Insane 1.80, the hoarder x8 0.81 (eighth round) |

Ratings are Bradley-Terry ratings on the Elo scale from 700 mixed bot tables (`runs/ladder-v3b.json`, rated with
`scripts/bt.py`). 200 points means the stronger side finishes ahead about 76% of the time. The current bots are
described in **The current bots (third generation)** at the end; the sections before it describe the first
generation, which is kept as a benchmark (`hard0`, `insane0` in `scripts/registry.mjs`).

## The problem, from a bot's point of view

A bot faces six kinds of decision: on its turn (auction the next animal, or start a koehandel and with whom),
in an auction (how far to bid), as auctioneer (sell, or buy the animal back), when paying (which cards), as the
starter of a koehandel (how much to offer, and with how many cards) and as its target (accept, or counter with
how much).

What makes Koehandel hard for a computer:

- **Hidden information.** Other hands are secret (only card counts are visible), koehandel amounts stay secret,
  the deck order is unknown, and with a smaller deck even the number of each animal is unknown.
- **3 to 5 players**, so there is no single opponent to "beat"; what matters is finishing first.
- **Huge, continuous-ish moves.** Bids are any multiple of 10; offers are any subset of a hand of up to ~20 cards.
- **Real-time auctions** where everyone may bid at any moment.
- **A tiny compute budget.** Bots run inside a serverless request (Vercel), so a decision gets a few hundred
  milliseconds of one CPU at most, with no GPU.

### Options considered

| Approach | Verdict |
|---|---|
| Minimax / exhaustive tree search | Out: imperfect information, 3-5 players, simultaneous bidding and a branching factor in the thousands. |
| Neural network trained by self-play (RL, AlphaZero-style) | Possible, but it needs millions of games and careful design of inputs for card subsets and hidden money, and the result is a black box that is hard to tune into "easy" and "medium" versions. The gain over a well-tuned model of the game is uncertain for a game this size. Tried later as a learned evaluation (see "What did not work"): it predicted better and played worse. |
| Hand-written rules | Fast and explainable but brittle: rules of thumb break in situations nobody thought of. Used only for the "novice" stand-in that calibrates Easy. |
| **A small model of the game + tuned parameters + Monte Carlo search** | **Chosen for the first generation**; the current bots replace the search by predicting the other players and, for koehandels, solving the hidden-hand game (see the end). One principled evaluation function drives every decision; its 17 parameters are tuned by self-play with an evolution strategy; Insane adds determinized Monte Carlo playouts on top. Fast, explainable, and it gives natural knobs for the easier levels. |

## The brain (`lib/bots/brain.js`)

### What a bot may know

`observe(state, i)` builds everything a bot is allowed to use: its own cards, everyone's animals and card counts,
the deck size and what has been drawn, the recent koehandels, and **money estimates** the engine keeps for this
purpose: a public ledger (start money, mule payouts and auction prices, which everybody sees) plus what this player
privately learned (amounts in its own koehandels, overpayments it received). Bots never read other hands, the deck
order or the secret composition of a smaller deck.

### The position model

For every animal type, each player's chance to end up owning the whole set is modelled as

```
strength(j, t) = (held(j, t) + rho * stillToCome(t) / players) ^ gamma  *  (money(j) + mu) ^ delta
chance(j, t)   = strength(j, t) / sum of strengths
```

From those chances follows each player's expected final score under the real scoring (sum of set values times the
number of sets, computed exactly for independent sets), and a soft chance to win:

```
E(j)   = expected score of j
win(i) = exp(E(i) / tau) / sum_j exp(E(j) / tau),     tau = tau0 * (average E + tau1)
```

`win(i)` is the bot's sense of "how good is this position for me". Every decision compares it before and after:

- **Bidding:** the highest price at which "I get the animal and pay this" still beats "someone else gets it
  (weighted by who likely wants it) and pays this to the auctioneer", found by binary search. Auctions are English
  auctions, where bidding up to your true value is the right strategy, so the bot just needs a good value.
- **Auctioneer:** buy back if "I keep it and pay the bidder" beats "the bidder pays me".
- **Koehandel offer:** every amount the hand can make is scored by `(1 - q) * win(I win the animals, pay x) +
  q * win(they win them, I get the difference)`, where `q` is the chance the other player can and will beat `x`
  (from their estimated money). The cards are the exact amount with the fewest cards, padded with zeros to bluff.
- **Answering a koehandel:** the offer is unknown; the bot guesses it from the number of cards, the attacker's
  average card value and estimated money (five weighted guesses), then compares accepting with every possible
  counter (the higher offer wins and the offers swap hands, ties as in the rules).
- **Turn:** an auction is worth the position plus some expected income; each koehandel is worth its best offer's
  score. Animals left by players who are gone are taken for free.

Unknown deck composition (smaller decks) is handled exactly: every composition of 2-4 per type that adds up to the
deck size is equally likely up front, and drawing `s` cards of a type that has `c` copies has likelihood
`c!/(c-s)!`, so the bot computes the expected number still to come for each type (cached).

### A subtle failure: endless koehandels

Once the deck is empty a koehandel is compulsory. With uneven holdings (2 against 1) whoever wins can simply
reverse them, and early versions of the bots did that forever (up to 4% of self-play games never ended). Only a
win by the bigger holder ends such a contest, so the table now remembers recent koehandels and on a repeat the
bigger holder plays to win while the smaller one lets go. Since then no simulated game has failed to finish.

## Tuning (`scripts/tune.mjs`)

The 17 parameters are tuned with **sep-CMA-ES** (Ros & Hansen 2008), a derivative-free evolution strategy that is
robust to noisy fitness. Each generation samples 16 parameter sets; each one plays **duplicate deals** against a
fixed field at 3, 4 and 5 players: every deal is played once with the candidate in each seat, which removes most of
the luck of the cards and of the seating. Fitness is win share times players (1.0 = exactly as good as the field).
All candidates of a generation see the same deals (common random numbers), so differences are real differences.

Tuning runs in stages, each against the winner of the one before, so the bot does not just learn to exploit one
opponent:

| Stage | Field it was tuned against | Result (4 players, fair share 25%) |
|---|---|---|
| A | the hand-set default parameters | wins 70% against three default bots |
| B | stage A (pure self-play) | wins 32% against three stage-A bots |
| C | stages B and A | 35% against three B bots, 43% against three A bots |
| D | C, B, the novice, the defaults and Easy | better against weak players (63% vs 55% against novices) but only 21% against C |

Hard uses **stage C**: in mixed tables C and D rate the same (560 vs 550 in `runs/ladder-stages.json`) and C wins
the head-to-head. A lesson for future tuning: the field matters a lot. Stage A, tuned against weak bots, learned
to overbid (it beats novices 66% of the time but loses to everything later); self-play stages learned restraint.

![tuning curves](img/tuning.svg)

The tuned parameters are in `lib/bots/params.js` (from `runs/stageC.params.json`). Each stage logs one line per
generation in `runs/stage*.jsonl`.

## Difficulty levels (first generation)

- **Hard**: the stage-C parameters, played exactly.
- **Medium**: the same parameters, but every price it comes up with is blurred (lognormal noise, sd 0.5) and 20% of
  its turn choices are careless. It rates about halfway between Easy and Hard.
- **Easy**: see below.
- **Insane**: Hard plus search, see below.

### How "Easy" was calibrated

There is no data on real beginners, so `scripts/novice.mjs` stands in for one: a player who knows the rules and
the animal values and follows the rules of thumb new players use (bid on valuable animals and ones you already have,
buy back what you collect, koehandel when you have a pair, offer a chunk of your money, defend what you own).
Easy was then made weaker until it wins exactly as often as that novice. Simply adding randomness made it play
erratically, which is not what a beginner does, so Easy instead gets *naive habits*: it bids timidly, sees sets
as worth little more than their animals, cares little about money, and still slips now and then.

In mixed tables Easy rates 292-332 across three tournaments against the novice's 300-336, so the two are level.
Its settings: `shade 0.9, mBid 0.1, gamma 1, delta 0.25` (`lib/bots/params.js`), noise 0.35 and 15% careless
turns (`lib/bots/index.js`).

### Ratings

Ratings come from mixed tables (3-5 bots of random levels, `scripts/ladder.mjs`), turned into Bradley-Terry
ratings on the Elo scale from every pair of seats in every game (higher score wins the pair), with Random at 0.
200 points means the stronger side finishes ahead about 76% of the time.

![ratings](img/ladder-calib3-elo.svg)

![head to head](img/ladder-calib3-matrix.svg)

`ladder-stages` rates the tuning stages against each other and the other bots; `ladder-calib` and `ladder-calib2`
are the calibration runs for Easy and Medium (the candidate specs are in `runs/specs.json`).

## First-generation Insane: Monte Carlo search (`lib/bots/insane.js`)

Insane starts from Hard's judgement and checks it by simulation. Before a big decision it lists a few candidate
moves (Hard's own move and alternatives around it: other bid limits, offers, counters, koehandel targets), then:

1. **Imagines the hidden part of the table**: the money cards it cannot see are dealt over the other players with
   their visible card counts (of several random deals, one that fits the money estimates and any standing bid is
   kept), an offer lying face down becomes some of that player's imagined cards, and the rest of the deck (and, with
   a smaller deck, its composition, drawn from the exact posterior) is shuffled.
2. **Plays every candidate out** in the same imagined worlds, everyone playing as Hard, for a fixed number of moves,
   then scores the result with the position model (or the real result if the game ended).
3. Picks the candidate that did best.

This is "determinized" Monte Carlo (perfect-information Monte Carlo) used as a one-step policy improvement over
Hard. Using the same worlds for all candidates (common random numbers) makes even a few dozen playouts informative.
The budget is fixed (not time-based) so a bot move is the same whichever request triggers it.

### Results

Insane in one seat against three Hard bots, 60 duplicate deals (240 games) per setting (`runs/exp-vs-hard.json`):

| Imagined worlds | Moves played out | Win share (fair 25%) |
|---|---|---|
| 4 | 16 | 44.6% ± 3.2 |
| 8 | 16 | 53.8% ± 3.2 |
| **16** | **16** | **63.3% ± 3.1** (used live) |
| 32 | 16 | 64.0% ± 3.1 |
| 8 | 32 | 40.0% ± 3.2 |
| 8 | to the end | 5.8% ± 1.5 |
| 16 | 1 | 4.6% ± 1.3 |

![search budget](img/insane-worlds.svg)

![playout depth](img/insane-depth.svg)

The depth matters more than anything:

- **Too short (1 move):** the candidate's own auction or koehandel has not resolved yet. The candidates look nearly
  the same, so the choice is noise.
- **Too long (to the end):** a finished game is a plain win or loss. With 8 samples per candidate that is mostly
  luck too.

Either way the bot picks among its candidates almost at random. The list deliberately includes extreme options
(bid nothing, overbid, all-in offers), so random choices are worse than Hard. Sixteen moves resolves the move and
what follows, and the brain's smooth estimate judges the rest. Beyond 16 worlds the gain flattens.

Cost: with 8 worlds a decision took a median of 53 ms (p90 116 ms) on a laptop core while other work was running.
16 worlds is roughly twice that, which fits a serverless request.

## Thinking time and bidding speed

Bots wait before moving so they feel like players: on average a quarter of the table's time per move (capped at
10 seconds so long limits do not drag; paying takes half as long), with a spread that shrinks as the level goes up.
The Confusing bot is all over the place. In auctions they answer a bid after 1.5-2.6 seconds on average, raise in
small steps (bigger when far below their limit) and always bid before the clock runs out.

![thinking time](img/think.svg)

## Random and Confusing

- **Random** makes uniformly random legal moves (random bids, random koehandels, random cards).
- **Confusing** plays like a sensible player on a very strange day. It makes generous koehandel offers (more than
  the other player could ever counter, or half its money), lets lowball offers slide, pays with big notes instead
  of exact change, sometimes bids animals far beyond their worth and sometimes lets bargains go, and picks odd
  koehandel targets. It is not trying to lose, but its gifts move money around the table in ways nobody sees
  coming: the player it lets off cheap may suddenly out-money the next one in their koehandel.

## Smaller decks

The bots handle the secret composition exactly (see above) and the test suite plays full bot games with 24- and
26-card decks. Nothing was tuned for smaller decks, but the current Insane still beats Hard at 3 players with 26
cards (1.38 ±0.12).

## Reproducing

```bash
node agent/scripts/gauntlet.mjs insane "hard0;shark;caller;padder" 50 3   # one bot against several opponents
node agent/scripts/arena.mjs insane "hard" 100 40 3,4,5                   # candidate vs field (fields: a;b)
node agent/scripts/ladder2.mjs agent/runs/ladder.json 700 "easy;medium;hard;novice;random"
python agent/scripts/bt.py agent/runs/ladder.json [3]                     # ratings (optionally 3-player tables only)
node agent/scripts/trace.mjs 7 "insane;hard;hard"                         # a readable game
node agent/scripts/ledger.mjs "insane;hard0;hard0" 30                     # where each seat gains and loses
node agent/scripts/offers.mjs "insane;insane;insane" 5                     # koehandel offers vs what the defender had
node agent/scripts/speed.mjs insane 3 3                                   # time per decision
node agent/scripts/spsa.mjs agent/runs/spsa.jsonl 40 30 3 '<base spec>' 'field;names'
node agent/scripts/gauntlet.mjs insane "ins4;shark;xB" 150 3 20             # the same at 20 cards (last arg: deck size)
LOOK=1 node agent/scripts/trace.mjs 13 "insane;shark;shark" 20            # a game, with what each side believes about money
node agent/scripts/tune5.mjs t5b 26 insane "insane;hard;shark;novice" 20 3 "small.shade:0.95:1.5,..."  # CMA-ES vs a field
node agent/scripts/tune5.mjs x5a 20 v2 "insane" 20 3 "shade:0.6:1.8,khBias:-0.3:0.3,..."  # search for a counter-strategy
VIEW=0 node agent/scripts/esterr.mjs "insane;shark;shark" 60 20            # money estimate error (also of the tracker)
node agent/scripts/endkh.mjs "insane;insane;insane" 120 20                 # endgame koehandels: who wins, what is paid
WHY=1 node agent/scripts/rebuild.mjs games/<file>.json                    # a logged game: what the bots would do now, and why
node agent/scripts/broke.mjs "insane;shark;shark" 40 20                   # how often seat 0 goes broke early, and its wins then
node agent/scripts/gauntlet.mjs shark "insane" 150 3 20                    # the other side: one shark against two Insanes
node agent/scripts/calib.mjs "insane;shark;shark" 30 20                    # the model's win chance against who won, by stage
node agent/scripts/splits.mjs "insane;insane;insane" 40 20                 # who gets a split pair, against the model
node agent/scripts/tune5.mjs x6 14 insane "insane" 20 3 "small.shade:0.6:2.2,..."  # a counter-strategy on Insane's judgement
# (a tune5 field entry vs:x scores the other side: x alone against the candidate in every other seat; POOL=n caps the workers)
node agent/scripts/sprt.mjs "insane:small.shade=1.2" insane "shark;vs:x6" 20  # is a change better? sequential test on paired deals
ROLL=40 node agent/scripts/audit.mjs "insane;xB;shark" 0 1 20 out.jsonl     # regret audit (then: audit.mjs --sum out*.jsonl)
node agent/scripts/golden.mjs insane 3                                     # hash of every move: must not change in a speed-up
node agent/scripts/gamespeed.mjs insane 10 20                              # time per game, one thread
```

### C++ simulator (`agent/cpp`)

Long experiments can run on a C++ port of the engine, the sim loop, brain, expert, solver, tracker and the experiment
opponents (shark, novice, the exploiters, named specs in `agent/runs/specs2.json`). It plays the JS games move for move.
The JS stays the reference, and the live bots never use the C++. Same command lines and seeds as the JS scripts, so the
results are the same. Run from the repository root (g++ 16, MSYS2):

```bash
sh agent/cpp/build.sh                                                    # builds everything (and agent/cpp/levels.json)
sh agent/cpp/build.sh gauntlet movelog                                   # only these (fast math; movelog exact): much quicker
./agent/cpp/gauntlet.exe insane "hard;shark;xB;x6" 60 3 20                # = gauntlet.mjs (POOL=n caps the threads)
./agent/cpp/sprt.exe "insane:small.shade=1.2" insane "shark;vs:x6" 20     # = sprt.mjs (D, BATCH as there)
./agent/cpp/tune5.exe x8 14 insane "insane;vs:shark" 20 3 "small.shade:0.6:2.2,..."  # = tune5.mjs (DEALS LAMBDA SIGMA START; SEED)
./agent/cpp/gamespeed.exe insane 10 20                                    # = gamespeed.mjs
ROLL=24 EVERY=2 ./agent/cpp/audit.exe "insane;person;person" 0 30 40 out.jsonl  # = audit.mjs, games in parallel (--sum in JS)
sh agent/cpp/check.sh "insane;shark;xB" 20 1 10                            # JS and C++ move logs of 10 games: must be "same"
```

- Exact: `*_exact.exe` and `movelog.exe` use ports of V8's own `exp`, `log`, `pow` and `cos` (`jsmath.h`), so they give
  bit-for-bit the JS results. The plain builds use the C library's math, which differs in the last bit now and then.
  Their games drift away from the JS ones, but they are statistically the same. Both are about equally fast.
- Settings: every program reads the levels and `TRACKER` from `lib/bots` when it starts (`levels.mjs` writes
  `agent/cpp/levels.json`; `KH_NO_REFRESH=1` skips that). Changed parameters therefore carry over by themselves. Changed
  code must be ported by hand, and then `check.sh` shows whether the port is right.
- Speed, one thread, 3 players (JS → C++): hard 70 → 20 ms per game at 20 cards and 1.3 s → 0.2 s at 40. Insane 320 → 60
  ms at 20 cards and 1.6 s → 0.27 s at 40. That is 5-6x, the same again per thread in parallel.
- Not ported: the JS-only experiment hooks (`endRoll`/`endgame`, `endModel`, `net:`, `peek:`), the first-generation bots
  (`hard0`, `easy0`, `medium0`, `insane0`, kind `smart`/`insane`), and the random and confusing levels.

Names are resolved by `scripts/registry.mjs`: levels (`easy` ... `insane`), first-generation bots (`hard0`,
`medium0`, `easy0`, `insane0`), stand-ins (`novice`, `shark`), exploiters (`padder`, `caller`, `keen`, `sniper`, `hoarder`, `seller`,
see `scripts/exploiters.mjs`), variants (`v2:delta=0.6,solve=1`; `insane:small.shade=1.2` changes a 20-card setting),
`peek:<name>` (sees everyone's money, for experiments; it also drops the opening bids) and the candidates in
`runs/specs2.json` (among them `ins4`, the fourth-round Insane, and the counter-strategies `xA`, `xB`). Scripts use every core but one.

The first-generation scripts (`tune.mjs`, `match.mjs`, `ladder.mjs`, `insane_exp.mjs`, `analyze.py`) still work for
the first-generation bots.

## The current bots (third generation)

The first generation (everything above this section) was tuned by self-play and settled into habits that only
work against copies of itself. The second generation (`lib/bots/expert.js`) kept the position model but rebuilt
every decision around predicting the other players from their side of the table. The third generation adds a
game-theoretic koehandel solver for Insane, recalibrated levels, personalities and a lot of measurement against
opponents that play differently.

### Decisions (`lib/bots/expert.js`)

- **Auctions:** an English auction, so the bot stays in while being the highest bidder at this price beats the next
  best outcome, counting the auctioneer's buy-back. It bids 10 whenever that beats the auctioneer keeping the
  animal for free, and counts what its cards really pay (no change is given).
- **Turn:** auctioning is valued by going over every animal that can come up, predicting the price from the
  others' bid limits, and choosing to sell or buy back. Each possible koehandel is valued by planning the offer.
- **Koehandels (Hard and below):** the attacker predicts the defender's answer to every possible offer (amount and
  number of cards), with the defender modelled as a mix of a careful reader, a naive "n cards are worth n times
  the average" reader and one who thinks any cards are equally likely. The defender reads the offer the same way.
- **Money estimates:** the engine books secret koehandel amounts at what that number of cards usually stands for
  (refitted on Insane games: the error late in the deck phase halved, from 64 to 35) and tracks how unsure
  everyone should be; `look()` blends that with card counts and the known total, inside
  hard bounds (what the cards can add up to, and at least what a player bid since their last koehandel).

### Koehandel as a game of hidden hands (`lib/bots/solver.js`, Insane)

A koehandel is a small poker game: the attacker puts down cards face down, the defender sees only how many and
accepts or counters, and both hands are hidden. Insane solves it each time instead of guessing:

1. **Types.** It samples hands the attacker could hold (as the defender sees it) and hands the defender could hold
   (as the attacker sees it), from the cards it cannot see and the money estimates. Its own hand is one of them.
2. **Strategies.** For every attacker hand a mix of offers (amount and number of cards, so padding with zeros is
   part of it), for every defender hand and number of cards seen a mix of answers (accept or a counter).
3. **Fictitious play.** Each side repeatedly answers the other's average strategy best; the averages converge to
   strategies where neither side gains much by deviating. The values of the outcomes come from the position model
   (money and animals for both players).
4. **Play.** As attacker it plays the equilibrium mix among the offers that are nearly as good as the best one
   (so its card counts give little away); as defender it answers best given what offers with that card count mean.

Because a pile of zeros is part of the attacker's strategy in the solution, the defender cannot be milked by
bluffs, and the attacker gets exactly as much as the defender's position lets it. Two details made it fast enough
for a server request: a counter's value does not depend on which defender hand makes it (so all defender hands are
answered together), and the answers to card counts nobody plays are computed once. Settings: 13 sampled hands per
side, 80 rounds of fictitious play; a koehandel decision takes a median of 30-90 ms
(p90 about 270 ms, worst seen about 0.6 s at 3 players under load); each offer considers at most 5 card counts per
amount, which cut the worst case at 5 players from 1.1 s to 0.26 s.

Results at 3 players (win share x players, 1.00 = fair, duplicate deals): the solver alone against v2 1.86-2.06
(±0.08); a bigger budget (13 hands, 80 rounds instead of 9 and 45) is worth another 1.20 head to head, more than that
gains nothing. Against a set of opponents (before the recalibration below, 50 deals each, ±0.10):

| Opponent | Score |
|---|---|
| v2 (Hard) | 1.86 |
| shark (sharp-human stand-in) | 2.24 |
| sniper (bids 10 except on its own animals) | 2.12 |
| padder (bluffs with piles of zeros) | 1.87 |
| caller (always counters high) | 1.84 |
| keen (bids 30% over value) | 1.44 |
| novice | 2.66 |
| first-generation Hard | **0.72** |

The one loss led to the recalibration below.

### Recalibrating the model: money was overvalued

Against the first-generation Hard (`hard0`) at 3 players the solver bot lost (0.72): it sold about 9 animals a
game for about 100 each and bought only 6, ending with 2.5 sets against hard0's 3.3-4.2. Testing one hypothesis at
a time against hard0 showed the model valued money too much: lowering the money exponent `delta` from 0.86 to 0.6
(and bidding 10% above the model's limit, `shade` 1.1) turned 0.83 into 1.41 against hard0 and also beat the old
settings head to head (1.33) and against the shark (2.02). It now buys 12 animals a game, completes 3.5 sets and
wins 63% of games against two hard0s. (An SPSA run, `scripts/spsa.mjs`, was drifting the same way but more slowly;
targeted tests were faster.)

Insane's final settings (`INSANE` in `lib/bots/index.js`: delta 0.6, bids 15% over the limit) score, at 3 players,
1.62 against hard0 and 1.88 against Hard; at 4 players 1.77 against Hard and 1.49 against hard0; at 5 players 1.67
and 1.77. Hard keeps the old valuation: without the solver the lower delta loses to plain v2 (0.84) even though it
beats hard0 (1.82), so the gain comes from the combination with the solver.

Insane (final) against every kind of opponent at 3 players, 40 duplicate deals each (±0.09-0.14):

| Hard | hard0 | shark | caller | padder | keen | sniper | novice | Medium | Easy |
|---|---|---|---|---|---|---|---|---|---|
| 2.08 | 1.43 | 2.15 | 1.95 | 2.50 | 1.85 | 1.69 | 2.65 | 2.50 | 2.00 |

(3.00 would be winning every game.)

### Reading a player's habits

The engine keeps a history the bots may learn from (`s.hist`, filtered per player in `observe`): every auction
(everyone's highest bid, the price, a plain bidder's limit from public information) and every koehandel (card
counts and winner for everyone; amounts and cards only for the two players in it). Insane uses it as defender:
an attacker's earlier offers to it (amount per card) are mixed into how it reads the next offer from that attacker,
with more weight the more offers it has seen. Against the padder (who bluffs with piles of zeros) that is worth
2.40 instead of 2.01; it changes nothing against players without such habits (0.97). The same idea for the
attacker (how a defender answered before) gained nothing against the caller and is off (`habitsA`).

### Levels, calibration and personalities

| Level | Settings (`lib/bots/index.js`) |
|---|---|
| Easy | naive koehandels (no zero padding, reads offers as n times the average card), bids 20% under its limit, prices blurred (lognormal sd 0.4), 20% careless turns, rarely buys back |
| Medium | the full judgement, prices blurred (sd 0.2), 6% careless turns |
| Hard | the full judgement |
| Insane | the full judgement, the koehandel solver, the recalibrated model |

Easy and Medium were calibrated in mixed tables of 3-5 bots (`scripts/ladder2.mjs`, `scripts/bt.py`,
`runs/ladder-v2cal1.json`; candidates in `runs/specs2.json`):

| Bot | Rating (all tables) | Rating (3 players) |
|---|---|---|
| v2 (Hard) | 710 | 817 |
| Medium (candidate A) | 457 | 446 |
| first-generation Medium | 420 | 460 |
| first-generation Easy | 373 | 378 |
| Easy (candidate B) | 251 | 289 |
| novice stand-in | 233 | 293 |
| Random | 0 | 0 |

In the final tournament (`runs/ladder-v3b.json`, after a fix that made Easy and Medium counter where noise used to
turn a small counter into accepting, and with the refitted money estimates) Easy rates 261 against the novice's 269
and Medium 419, about halfway between Easy and Hard (642). Ratings move by up to about 80 points between
tournaments of this size, so treat them as approximate. Easy plays like the beginner stand-in, without nonsense: it knows the rules and what animals are
worth, but it takes koehandel offers at face value, never bluffs with zeros and misjudges prices. Medium sits
halfway between Easy and Hard.

Every bot seat also gets a personality, fixed for the game from the table's seed (`styleOf`): how keen it bids,
two favourite animals it bids a little more for, how eager it is to koehandel and how readily it buys back. The
spread is large for Easy, small for Hard and Insane; it costs Hard nothing measurable (0.996 against plain v2).

### What did not work (and why)

- **A learned evaluation (neural network).** 4000 self-play games (950k positions), trained on the GPU
  (`scripts/datagen.mjs`, `value_train.py`, `net.mjs`). It predicts the winner much better than the hand-made model
  (log loss 1.05 against 1.19) but plays much worse (0.65 against the same bot with the hand-made model): decisions
  depend on the fine trade-off between money and animals, which outcome prediction does not learn from this little
  data. Kept as an experiment.
- **Card tracking with a particle filter** (`scripts/tracker.mjs`): a few hundred guesses of every hand replayed
  through every public event. Exact as long as only auctions happen, but koehandel offers are too strategic to guess
  from card counts, and it ended up worse than the regression-based ledger. Knowing everyone's money exactly would be
  worth a lot (a cheating version wins 1.50 against the honest one), so better inference remains the largest open
  lever.
- **Adapting to opponents' bidding keenness** (`th.adapt`): the bots measure how high each player bids compared to a
  plain bidder (from public information the engine keeps), but against bots that bid consistently it only added
  noise (0.88 for the solver bot; for Insane against keen and sniper bidders 1.75-1.95 and 1.48 instead of 1.85 and
  1.69). Off by default; worth a test against people.
- **No measurable gain:** a solver budget beyond 13 hands and 80 rounds (1.00), solving the top two koehandel
  candidates of a turn with the full budget (0.97), predicting rivals' full English-auction limits when valuing an
  auction (0.96), a different softmax temperature `tau` (0.92), more or less weight on "any cards are equally likely"
  in the defender's reading (0.90-1.09), and modelling the other players with the standard money valuation
  instead of Insane's own (0.57), or only when valuing its own auctions (0.88).

### Fourth round: lessons from a game against people

A 20-card test game at three players (two Insane bots and a person, logged and replayed with
`scripts/replay.mjs`) showed three mistakes that bot-only testing had not:

- **Money known exactly, but not used.** After the person bought a duck back for 50 they held exactly 40, which
  everyone could work out; the bot next to act held the other duck and plenty of money, but auctioned a cat instead of
  taking the duck pair for 50. And an Insane bot offered 20, padded to four cards, to a player who visibly held two
  zeros. Both came from how the bots imagine the other side's hands: random hands, weighted loosely by how close their
  total comes to the money estimate. Even when the estimate is exact that leaves real weight on hands worth 90 or 20.
  **Sharp guesses** (`th.sharp`): every guessed hand is built to add up to a total drawn around the estimate (cards
  swapped in from the pool until it fits), spread only by the real doubt: secret koehandel amounts, and auction
  payments the viewer did not handle that may have overpaid (no change is given; with one card that happens a quarter
  of the time, `scripts/overpay.mjs`). In the two situations the bot now takes the duck pair (7 of 8 tries, was 0) and
  offers the broke player nothing.
- **Padding for nothing.** The attacker plays the equilibrium mix among the offers nearly as good as the best, and
  padding with zeros was free. Now each zero given away costs a little (`th.padCost`): zeros kept are bluffs for
  later, zeros given away are the other player's.
- **The last stand.** Once the deck is empty and, whichever way a koehandel goes, a player ends up sharing no animal
  type with anyone, nothing can change that player's score afterwards and money is worth nothing: putting everything
  in can only help (`th.allIn`; it was a coin flip between equal options before, and once that meant offering nothing).

Two more changes came out of looking at 20-card games, the size the game gets tested at:

- **The money offset follows the money in play** (`th.muScale`). The model values money as (money + mu)^delta with
  mu = 508: about half of what a player ends up with in a 40-card game (90 start money plus 850 from four mules),
  but twice it with 20 cards (two mules, 150). There money hardly counted, and Insane was only level with the
  first-generation Hard (0.98). Scaling mu with the money each player can expect by the end (940 for the full deck)
  leaves 40-card play unchanged and fixes the smaller decks: at 20 cards 1.55 against Hard, 1.71 against the old
  Insane (a lower or higher delta, or a different shade, did far less: 0.84-1.42).
- **Opening bids** (`th.open`). Bids rise in steps of 10 from the highest bid, so a bidder nobody outbids wins at 10,
  and the auctioneer can buy the animal back for nothing. In a 20-card game that is common: with pairs, often only
  the player holding the other one bids. The bot now opens with the bid that does best in the cases where the
  others stop below it (their predicted limits, give or take; whether the auctioneer buys back is treated as a
  chance that grows with how much better buying looks to them), but never higher than a price it would be glad to
  pay if the auctioneer sells. Against bots at 40 cards it is about neutral; at 20 cards, with the money offset fixed,
  it adds a lot (1.82 against Hard, 1.94 against the old Insane). With the offset still wrong it lost badly (0.68 to
  0.83): it opened with all its money for animals the model valued above everything.

Results of the new Insane (all five changes) at 3 players, win share against two of the opponent (1.00 = level):

| Deck | old Insane | Hard | first-generation Hard |
|---|---|---|---|
| 20 cards | 2.08 | 1.87 | 1.85 |
| 26 cards | 1.61 | 1.69 (old Insane: 1.22) | |
| 40 cards | 1.25 ±0.14 | 1.88 ±0.13 | 2.11 (against one of each with Hard) |

Standard errors are about ±0.05 at 20 and 26 cards (300 duplicate deals) and ±0.10-0.14 at 40 cards. Against the
trick opponents at 40 cards: shark 1.95, padder 2.52, caller 2.13, sniper 1.70; at 4 players 1.03 ±0.16 against the
old Insane and 1.90 against Hard. Hard would gain from the money offset at 20 cards as well (1.28 against itself,
1.50 with opening bids too); it was left as it is, so that it stays beatable for experienced players.

Dropped after testing: an **endgame lookahead** (once the deck is empty, the koehandel to start chosen by playing
the rest of the game out 24 times per option with the first-generation bots, on guessed hands, real scoring;
`scripts/endgame.mjs`): 1.13 ±0.11 head to head at 40 cards, nothing at 20 cards, and seconds per decision. A
**separate money weight for the endgame** (0.90 and 0.98). **Counting mule money still to come** in the money term
(`th.kappa`, the idea that money on its way makes spending now safer): neutral (1.90/1.80/2.07 against
1.87/1.85/2.08 at 20 cards). **A better guess of secret koehandel amounts**: richer public features (stakes, both
players' money, holdings) and a boosted-tree model gave the same error per deal as the current two-feature formula
(146-152 against 147; `scripts/khdata2.mjs`, `khfit.py`): what is left is the hidden hands themselves.

Fine-tuning the new Insane at 20 cards (against itself / Hard, ±0.05): delta 0.5 1.02 / 1.82, 0.7 0.89 / 1.99, shade 1
0.79 / 1.89, shade 1.3 1.14 / 1.84, mDec 0.06 1.08 / 1.92. Bidding higher helps a little with 20 cards (shade 1.3) but
hurt with 40 (0.90), so a deck-size dependent shade is the next thing to try. Giving Hard the sharp guesses and the
last stand made it slightly weaker (0.93 against Hard at 20 cards, 1.02 at 40), so Hard keeps its old play. Levels
at 20 cards: Easy 1.69 against the novice stand-in (at 40 cards it is about level with it), Medium 1.45 against Easy
and 0.55 against Hard.

### Fifth round: robust against other kinds of players

The question this round: is Insane really a level above Hard, and does it beat players unlike itself? At 20 cards
and 3 players (the size the game gets tested at) Hard against two Insanes scores 0.67 and Insane against two Hards
1.87, so the step is real. But against the stand-ins for people it was much less dominant than against bots:
1.42 against the shark (a sharp human stand-in; Hard 1.20, the old Insane 0.94) and 1.97 against the novice.

Two things explained most of that:

- **Opening bids were tuned against bots.** Knowing everyone's money exactly (`peek:`) seemed worth 1.42 -> 1.77
  against the shark, while the money estimates were rarely off (`scripts/esterr2.mjs`). The `peek:` wrapper also
  dropped the opening bids, and that was the whole gain: without opening bids Insane scores 1.73 against the
  shark and 2.13 against the novice, but only 1.67 against Hard. An opening bid only pays when the auctioneer would
  otherwise buy the animal back cheaply, and Insane predicted that with its own model, which fits Hard (who buys
  back readily) and not players who mostly sell. Now that chance is blended with how often this auctioneer actually
  bought back so far (`th.openHist`, the model's guess counting as 2 earlier auctions): 1.66 against the shark,
  2.13 against the novice, 1.89 against Hard; at 40 cards 2.13 / 1.99 against shark / Hard (was 1.95 / 1.88). A new
  exploiter, `seller` (never buys back), is what a person adapting to the opening bids would do. What counts is
  price-aware: a sale at price p says they would also sell at more than p, a buy-back at p that they would also buy
  at less; a player who sold at 40-90 may still buy back at 10 (a hoarder did exactly that in a traced game).
- **Money matters more as the deck runs out.** In a lost game Insane paid 190 of its 200 for the second pig while
  the player holding the first one kept 70; that player then took the pair in a koehandel for 60. The model still
  gave Insane a 45% chance at the pig set, because money weighs the same from the first card to the last, while
  with the deck empty a split pair goes to whoever can pay more. `th.muEnd` and `th.deltaEnd` shrink the money
  offset and raise the money exponent towards the end of the deck: `muEnd=0.3` alone took Insane from 1.55 to
  1.74 against a mixed field at 20 cards.

Then all of the model's settings were tuned together at 20 cards, 3 players, with sep-CMA-ES against a mixed field
(Insane, Hard, the old Insane, hard0, shark, novice, seller; `scripts/tune5.mjs`, `runs/t5b.jsonl`). The result
(the centre averaged over the last 10 generations) bids higher (shade 1.32), weighs money less early (delta 0.53)
and much more at the end (delta 1.4, offset halved).

At 20 cards, 3 players, against two of each opponent (200 duplicate deals, ±0.05-0.06):

| Version | previous Insane | Hard | shark | novice | seller | third-generation Insane |
|---|---|---|---|---|---|---|
| previous Insane (fourth round) | 1.00 | 1.87 | 1.42 | 1.97 | | 2.08 |
| hand-picked (`openHist=2, muEnd=0.3`) | 0.89 | 1.77 | 1.86 | 2.33 | 1.62 | 2.01 |
| tuning run, final centre | 1.16 | 1.98 | 1.90 | 2.37 | 1.81 | 2.25 |
| **tuning run, centre averaged over the last 10 generations (used)** | **1.28** | **2.07** | **1.85** | **2.27** | **1.90** | **2.19** |

Those settings are bad with bigger decks (at 40 cards 0.55 against the previous Insane, 1.46 against Hard; at 26
cards 0.89 and 1.43). A 20-card deck is a different game: every animal comes exactly twice, so every set is a pair
and every split pair is settled by one koehandel. So the 20-card settings live in `th.small` and are blended into
the full-deck ones between 20 and 30 cards (`forDeck`).

Tried and dropped this round:

- **The endgame played out** (`scripts/endmodel.mjs`, `endModel=1`). Once the deck is empty the game is a series of
  compulsory koehandels: whoever can pay more wins a split type, the winner pays the loser (so losing one makes you
  richer for the next), and the order matters. A small model plays that out (the richer side wins, softly; payments
  as measured in bot endgames, `scripts/endkh.mjs`: the richer side wins 80-94%, and what the winner pays goes with
  its own money, not the loser's) and scores the result exactly, replacing the position model once the deck is
  empty. On the previous Insane it gained a little (1.13 head to head at 20 cards), but on top of the new settings
  it is neutral at 20 cards (1.33-1.44 against 1.34 for the previous Insane, 1.78-1.83 against 1.85 for the shark)
  and at 40 cards (1.02 / 1.92 / 2.13 against 1.06 / 1.99 / 2.13): the late-game money weighting already does
  what it does.
- **Adapting predicted bid limits to how keen each player bids** (`th.adapt` with a prior of 4 or 10 auctions):
  slightly worse against everyone (1.23-1.33 head to head, 1.82-1.85 against the shark, 2.16-2.20 against the
  novice, against 1.34 / 1.85 / 2.31).

A faster solver: the fictitious play kept recomputing every offer's value against the defender's average answer
from scratch each round. The values are now kept as running totals that only take in each round's new answers
(the result is the same up to rounding): the slowest koehandel decision at 20 cards went from 5.6 s to 0.08 s
under load, the median offer from 66 to 30 ms.

**Looking for a counter-strategy.** The stand-ins only test the holes someone thought of. To find others, an
opponent was tuned (CMA-ES over Hard's judgement plus its leanings: how keen it bids, how readily it buys back, how
eager it is to start koehandels, how it values money) for one thing only: beating two Insanes at 20 cards
(`runs/x5a.jsonl`). It drifts to one style: sell almost everything, never start a koehandel, keep the money, and bid
very high late (`xA`, `xB` in `runs/specs2.json`). On 200 deals it gets level with two Insanes (0.99 and 1.05;
the previous Insane gives up the same, 0.99, and two Hards 1.60). The mechanism, in traced games: with two Insanes
at the table, both bid for the same animals with the same valuation, so on the hoarder's auctions they push each
other to their limits and the hoarder collects; its money then decides every split pair in the endgame, and blocking
its sets comes too late to help (the model was right to sell the second horse to it: buying it back would have paid
the hoarder and left Insane broke against it). That is exactly a person playing two Insane bots.

Two answers. The turn choice values each possible koehandel by solving it roughly (5 hands, 25 rounds); with the
faster solver it can afford 9 hands and 45 rounds, and that is worth a lot against the hoarder: 1.84 against two
`xB` instead of 1.49 (shark 1.93 instead of 1.82, the previous Insane 1.33 instead of 1.31). Tuning the 20-card
settings again with both hoarders and tables of two Insanes in the field was started (`runs/t5c.jsonl`) but stopped
after 3 generations; it is the obvious next run.

**A better turn choice and card tracking (20 cards).** Two more changes for small decks, at 20 cards against two
of each (150 deals, ±0.07; previous Insane / shark / hoarder `xB`):

| Version | previous Insane | shark | xB |
|---|---|---|---|
| tuned 20-card settings | 1.31 | 1.82 | 1.49 |
| + turn choice solves with 9 hands, 45 rounds (`roughK`, `roughIt`; was 5 and 25) | 1.33 | 1.93 | 1.84 |
| same, with 13 hands and 80 rounds | 1.40 | 1.87 | 1.80 |
| bigger koehandel solves instead (20 hands, 120 rounds) | 1.37 | 1.79 | 1.60 |
| + card tracker for the money estimates (`track`) | 1.53 | 1.84 | 1.73 |
| **+ its hand guesses as the other side's hands in the solver (`trackHands`; used)** | **1.59** | **1.98** | **1.69** |
| the tracker's money estimates alone (`track=2`) | 1.61 | 1.97 | 1.64 |

The card tracker (`lib/bots/tracker.js`, formerly `scripts/tracker.mjs`) follows 160 guesses of every hand through
every public event. Against every kind of opponent at 20 cards its money estimates are closer than the regression
ledger's (when the deck is empty, mean error 29 against 42 with the hoarder at the table, 10 against 15 with
sharks; `scripts/esterr.mjs`), and a full replay of a game takes 5-35 ms. In play it raises the worst case (the
lowest of the three scores 1.59 instead of 1.33) and gives up a little against the hoarder. Both changes were only
measured at 20 cards, so they are part of the 20-card settings (`roughK`, `roughIt`, `track`, `trackHands` in
`th.small`; the tracker is on below 30 cards).

**The fifth-round Insane**, all of the above, at 3 players against two of each (±0.06-0.08): with 20 cards the
previous Insane 1.59, Hard 2.16, shark 1.98, novice 2.21, the counter-strategy `xB` 1.69 (previous Insane against
the same: 1.00 / 1.87 / 1.42 / 1.97); with 40 cards (where only the opening bids changed) the previous Insane 1.01,
Hard 2.03 (was 1.88). Hard against two Insanes scores 0.67 at 20 cards, so the step from Hard to Insane is large; Hard
itself is unchanged.

### Sixth round: a person against two Insanes

A person won a 20-card game against two Insanes comfortably, with the bots making moves that looked plainly wrong.
`scripts/rebuild.mjs` replays a logged game on the engine and asks the bots at every point what they would do now
and why (the bots repeat their moves exactly, since they get the table's seed and history). What it showed:

- **Kingmaking.** Late in the game Clover could hardly win, but its model still gave it a 15% chance while its share
  of the expected points was under 1% (the soft win chance compares expected scores with a wide temperature). In
  that state, moving money between the other two players changes its tiny chance more than its own position does:
  it offered 160 for a chicken where 110 was certain to win (its card tracker knew the person held exactly
  [0,0,100]), because handing the person money weakened the other bot, which was ahead. `th.own` adds a player's
  share of the expected scores to its utility, so a player who can hardly win plays for its own score (the offer
  drops to 130; the model's money valuation still likes paying a bit more).
- **Cheap buy-backs refused.** Pippin, with 370, sold a horse for 60 to a player left with nothing, and Clover sold
  the second cat for 20. Buying back looked better to both (by 4.6% and 3.2%), but buy-backs need a fixed margin
  of 5% (`mDec`, tuned against bots, who bid high so buy-backs are dear). Dropping the margin is worse (0.88 against
  the previous Insane, 1.75 against the shark), so it stays, but a cheap buy-back risks little: `th.mDecP` makes the
  margin go with the price (against half the average money, at most three times `mDec`).
- **Judgement, not a bug:** Clover sold the second chicken for 20 while holding the first, and Pippin, the richest
  by far, bid only 20 for the second goat while holding the first. In both the model expected to win the split pair
  later in a koehandel (being richer) and liked the opponent paying; its own koehandel solver agreed (the koehandel
  right after the sale was worth more to it than buying). The person then got richer and took both pairs. A chicken
  set alone is worth 10 points, so for a player with few other sets the 20 does count; the goat is the clearer
  error: a split pair is valued as a soft contest of money (72% for 4.5 times the money), not as what it costs to
  win it later. Turning the auction or koehandel for the last card into the other was a near tie (1.063 against
  1.056).

Both changes are neutral against the benchmark field at 20 cards (3 players, 150 deals, ±0.06-0.07), from both
sides, so they are kept for the visible blunders they remove; at 40 cards they cost a little (against the shark
1.84 with both, 2.01 without), so they are 20-card settings (blended out by 30 cards):

| Insane | prev. Insane | shark | xB | novice | shark vs 2x | xB vs 2x | Hard vs 2x |
|---|---|---|---|---|---|---|---|
| fifth round | 1.00 | 1.98 | 1.69 | 2.21 | 0.37 | 0.77 | 0.68 |
| margin by price (`mDecP`) | 1.02 | 1.86 | 1.72 | 2.29 | 0.35 | 0.81 | 0.63 |
| **+ own score (`own`; used)** | **0.99** | **1.79** | **1.77** | **2.30** | **0.37** | **0.81** | **0.57** |

(The last three columns are one player of that kind against two Insanes: lower is better for Insane.)

Live play changed too: a bot with only one possible move (paying, a turn with nothing to koehandel for, a buy-back
it cannot afford, answering without money) now takes a moment instead of a quarter of the time per move, and the
first bid on an auction comes late in the opening window (a bid shows interest, and nobody else may bid at all);
later bids come after 1.5-4 s instead of 1.5 s.

Also measured this round: at 4 and 5 players with 20 cards the fifth-round Insane is far ahead of the previous one
(4 players: 1.77 against the previous Insane, 2.52 Hard, 2.35 shark; 5 players: 1.89 / 2.75 / 2.47); at 4 players
with 40 cards it is level with it (1.01; Hard 1.91, shark 2.15). The better turn choice at 40 cards (`roughK=9,
roughIt=45`) is about level (1.04 against Insane, shark 2.16, xB 1.73). Tried and dropped: shares of the animals still
to come in proportion to money (Insane spends itself broke early in 77% of games against two sharks, but wins as
often then: 0.63 against 0.66; the change scored 1.47 against the shark); the soft buy-back chance in the bid limit
as well as in the opening bid (`softCap`: 1.08 against Insane, 1.93 / 1.70 / 2.11 / 2.30 against shark / xB / seller /
novice, and at 40 cards 1.16 / 2.09 against Insane / shark; promising, but not run to the end).

### Seventh round: is the model calibrated?

`scripts/calib.mjs` compares the soft win chance with who actually won, by stage. It is far too flat at every stage
and with every lineup: the temperature that fits the outcomes best is 0.2-0.4 times the one in use (at 20 cards
against two sharks, a player the model gives 25% wins 5-15% of the time; once the deck is empty, players it gives 18%
never won); the order is right (the model's favourite wins 93% of the time once the deck is empty). But a calibrated
chance decides worse: half the temperature is level (1.01 / 1.83 / 1.77 against Insane / shark / xB, against 0.99 /
1.79 / 1.77), 0.3 times is worse (0.86 / 1.72 / 1.67). The flat chance works as a cautious utility (closer to the
expected score against the others' average), so kingmaking stays handled through `own`.

`scripts/splits.mjs` checks split pairs the same way: once every card of a type is out and two players hold one
each, how often does the richer get the pair? With three Insanes: level money 51% (model 52%), 1.25-1.6 times the
money 62% (56%), 1.6-2.2 times 61% (60%), 2.2-3.5 times 53% (66%), more 64% (74%). So money decides split pairs less
than the model says once the gap is large, not more; the goat in the sixth round was not under-valued for that reason.
(The poorer side often attacks first and wins on the tie rule, or the richer spends its money elsewhere first.)

One person against two Insanes (20 cards, 120 deals): the stand-ins all stay below level: xA 0.82, xB 0.80, seller
0.66, keen 0.64, caller 0.58, Hard 0.56, padder 0.48, shark 0.35, Medium 0.33, hoarder 0.30, novice 0.21, sniper
0.03. `rebuild.mjs` gained `COUNTER=<animal>` (what a defending bot believed the offer was, and the value of each
answer): in the sixth-round game Pippin's counter of 210 for the horse was right on what it could know (it could not
beat the person's 250, and a tie at 250 ends with the attacker taking the animal free).

**A counter-strategy on Insane's own judgement** (`runs/x6.jsonl`, 14 generations of CMA-ES over Insane's 20-card
settings plus `khBias`, for one thing only: beating two Insanes). Already the first generation's average beat them.
The result, `x6` in `runs/specs2.json`, bids low (shade 0.7 against 1.32), rarely buys back (`mDec` 0.165) and avoids
starting koehandels (`khBias` -0.26). On 200 new deals it gets 1.42 against two Insanes (47% of the wins), and it is
a strong player in general: 1.78 / 2.04 / 1.56 against two sharks / Hards / xBs, about Insane's own level; Insane
alone against two x6 gets 1.28. The mechanism: two Insanes value an animal the same way and both bid 32% over their
model's limit, so on the third player's auctions they drive each other to that limit and the third player collects.
In each bot's own comparison (I win at p, or the other bot wins at p) the auctioneer's gain is the same either way,
so neither sees that the price feeds the auctioneer: a prisoner's dilemma between two equal bidders, and a person
playing two Insanes is that third player. Tried against it and dropped: the bid limit as a best answer to where the
others are predicted to stop (with limit c: the animal at the highest other stop + 10 below c, otherwise a rival gets
it at c), which sees that staying in raises the rival's price and feeds the auctioneer; it bids far lower and loses
(sequential test on shark / xB / x6 / one x6 against two / one shark against two: -0.05 blended half with the
price walk, -0.12 alone). The predicted stops are not good enough to aim at.

**Retuned with the counter-strategy and the other side in the field** (`runs/t6.jsonl`: CMA-ES over the 20-card
settings plus `khBias`, 14 generations, 24 duplicate deals per field entry, the field Insane / shark / xB / x6 and the
tables one x6 / xB / previous Insane against two candidates). It moved towards bidding at the model's limit (shade
1.32 to 0.95), money counting for more (delta 0.53 to 0.99), a flatter win chance (tau 1.46 to 2.2) and starting
koehandels a little less readily (khBias -0.19, now a 20-card setting; full deck 0). On 150 new deals (±0.04-0.07):

| | prev. Insane | shark | xB | x6 | Hard | novice |
|---|---|---|---|---|---|---|
| sixth round, against two of each | 1.00 | 1.79 | 1.77 | 1.28 | 2.16 | 2.30 |
| **seventh round (used)** | **1.13** | **1.88** | **1.83** | **1.74** | **2.32** | **2.49** |
| one of each against two sixth-round Insanes (lower is better) | 1.00 | 0.37 | 0.81 | 1.42 | 0.57 | |
| **one of each against two seventh-round Insanes** | **1.22** | **0.29** | **0.89** | **0.59** | **0.65** | |

The hole x6 found is closed, and it is better against every field; the cost is that a keen bidder (the previous
Insane) now does well alone against two of the new ones (1.22): the same weakness of two equal bidders, from the other
side. So the counter-strategy search was run again against the new Insane (`runs/x7.jsonl`), as in league training
(AlphaStar): find what beats the current bot, add it to the field, retune, repeat. It found the opposite style:
`x7` bids keenly (shade 1.45, a large money offset) and gets 1.32 against two new Insanes (200 deals), but is weak
otherwise (1.65 / 2.24 / 2.16 against two sharks / Hards / xBs, 0.83 against x6, 0.92 against the sixth-round
Insane); Insane alone against two x7 gets 1.47. Head to head the two versions show the same pattern from both sides:
alone against two of the other, the new one gets 1.13 / 1.23 / 1.31 at 3 / 4 / 5 players, the old one 1.22 / 1.10 /
1.05 (40 cards: level, 1.00, as it should be). Every fixed bidding level leaves a pair open to the opposite style, so
the next step answers the table instead: `th.shadeK` scales the bid limit by the others' observed keenness (their
highest bids against a plain bidder's limit, `keenness`) to that power, which the tuner may set either way.

**40 cards: a pair of hoarders.** The final test is a 40-card game of two people against one Insane, and the
full-deck settings date from the third round. A counter-strategy search for that table (`runs/x8.jsonl`, C++ tune5,
field `vs:insane`: one Insane against two candidates, 18 generations) found `x8`: bid very low (shade 0.6), almost
never buy back (mDec 0.3), avoid starting koehandels, value money late (deltaEnd 2.2); several settings ended at the
edges of the search. On 200 new deals Insane gets 0.56 against two x8 (19% of the wins), and x8 alone against two
Insanes 2.19 (73%); x8 is a strong player in general (1.62 / 1.72 / 2.13 against two Hards / sharks / novices).
Insane's other 40-card results: Hard 2.04, shark 2.02, xB 1.65, fourth-round Insane 1.05, novice 2.58. The full-deck
settings were retuned with x8 in the field (`runs/t8.jsonl`, 22 generations, 30 deals per field entry); on 200 new
deals the result (`runs/t8.final.txt`) is a trade, not a win, so it is **not used yet**: against two x8 1.01 (0.56
before), shark 2.38 (2.02), the previous Insane 1.09, novice 2.54 (2.58), but Hard 1.73 (2.04) and xB 1.26 (1.65).
Next: retune with more deals per entry (the tuner's 30 are noisy enough to overfit) or a fitness that weighs the worst
opponent, then adopt only what is at least level everywhere.

**A card-tracker blind spot.** In a person's game Dolly was sure (sd 0) the person held 390 when they held 290. The
trace (`TRACK=<viewer>,<target>` in `rebuild.mjs`: after every move, whether the viewer's guesses still hold the real
hand) showed the truth dropping out in a koehandel between the two others, where Dolly knew both hands exactly: the
person put down 120 of their 140 and Barnaby his 100. The tracker tried 16 random card choices per guess, weighted
towards low offers, and a way to put down cards counted as often as there are card choices that make it, as if
players put down random cards; strong offers made of the few high cards got 2% of the weight and died out, and the
later deals with Dolly only patched the wrong guesses. Now every distinct set of cards each side could have put down
is enumerated (once per set: players choose an amount and the cards for it), high offers keep a floor weight, the
tracker keeps 400 guesses, and if every guess contradicts a deal the viewer saw it gives up (the bot falls back on the
ledger) instead of trusting a wrong certainty (`TRACKER` in `lib/bots/tracker.js`). Against bots the estimates are as
good as before (`esterr.mjs`, deck empty: 8 and 12 against 8 and 11 with sharks / a hoarder at the table); against
people it no longer rules out an all-in offer. What was left in that game was real uncertainty: in a koehandel Dolly
was not in, the person answered Barnaby's six cards with one card, and whether it was the 100 or a 0 cannot be told
from what Dolly saw.

**Regret audit** (`scripts/audit.mjs`): Insane's buy-backs and turn choices in 14 games at 20 cards (three Insanes,
and Insane with xB and a shark), every option played out 40 times by the same bots with the same luck. Its choice
was on average 5 points of win chance better than the best other option; clearly wrong (more than two standard
errors) were 2 of 56 buy-backs and 7 of 56 turn choices, all mid and late in the deck (auction against koehandel, both
ways). No kind of decision is consistently bad; bidding was not audited (the counter-strategy above says it is the
weak spot at tables of two Insanes).

**Speed.** The koehandel solver took about 75% of Insane's time (plus 19% garbage collection); its loop now runs on
flat arrays without allocating (`lib/bots/solver.js`), with the same moves in every game (`scripts/golden.mjs`, a
hash of every move in fixed-seed games: unchanged) and 3-6 times faster games. A line-for-line C++ port of the
solver (`agent/cpp/solve.cpp`) gives the same results bit for bit on 120 real cases (`agent/cpp/dump_solve.mjs`) and is
another 13.6 times faster (1.16 against 15.8 ms per solve; built with `-O3 -march=native -ffp-contract=off`:
`-Ofast` was no faster, and the exact build keeps the move-for-move check). `scripts/sprt.mjs` tests a change the way
Stockfish's fishtest does: paired duplicate deals, stopping as soon as the log likelihood ratio decides.

### Eighth round: the card tracker for the full deck, and a learned position model

**The tracker with 40 cards.** The card tracker was only on below 30 cards, and at 40 cards it was 18 times slower
(hoarders' koehandels: every pair of possible card sets of two big hands, for each of 400 guesses). The weight of a
pair of sets only depends on their two totals, so `tracker.js` now groups each side's sets by total and sums the pairs
that fit per group (prefix sums): the same distribution, sampled in a few steps, in linear rather than quadratic time
(a 40-card gauntlet against hoarders: 3 s instead of 41 s). With the tracker and the finer turn choice (`roughK=9,
roughIt=45`) on at 40 cards too, on 200 new deals against two of each (the third-round full-deck Insane, frozen as
`ins7`, in brackets): Hard 2.19 (2.04), shark 2.23 (2.02), xB 1.83 (1.65), x8 0.60 (0.56), `ins7` 1.34; x8 alone
against two of it 2.34 (2.19). Used (`track`, `trackHands`, `roughK`, `roughIt` in the full-deck settings).
`own` and `mDecP` stay 20-card settings (with them: x8 0.50, Hard 1.92, x8 alone 2.50).

**A learned position model** (`agent/value`, `lib/bots/value.js`). Every decision Insane makes compares the model's
"chance to win" before and after (`Model.util`); that model is a formula with about eight tuned numbers, and the
hoarder x8 (a set of those numbers) beating Insane alone said the formula itself is the limit, as hand-made
evaluations were for chess engines before NNUE. So the C++ simulator plays a few hundred thousand games between bots
of every kind (`agent/cpp/datagen.exe`: Insane, Hard, shark, xB, x8, x7, novice, Medium, seats drawn at random) and
records every turn start with who won in the end; a small network learns from that each player's chance to win
(`agent/value/train.py`, PyTorch). It has the formula's shape, learned instead of fixed: per player and animal type a
shared network reads the player's copies, the most and second most any other player holds, the copies still to come
and the type's value; the results are summed over the types and a second network turns them, the money (own and
the others'), the money cards, the deck left and the mules into a score; the chances are a softmax of the scores.
Money only enters the second network, so a decision that moves money re-runs only that, and one that moves an animal
only that type's networks (125,000 evaluations per game; a game takes 3.6 times as long). The weights are exported as
plain JavaScript (`agent/value/export.mjs` → `lib/bots/net<id>.js`, listed in `lib/bots/nets.js`) and `th.net=<id>`
switches a bot to them (`netT`: a temperature on the scores; `netMix`: a blend with the formula). JS against PyTorch:
equal to 3e-8 (`agent/value/check.mjs`); the C++ (`agent/cpp/brain.h`) plays the JS games move for move.

It predicts the outcome far better than the formula (log loss on held-out games, 3 players, 40 cards; 1.10 is a
uniform guess): 0.76 against 0.89 for the formula at its best temperature (0.97 as Insane uses it), in the last
quarter of the deck 0.52 against 0.85; with 20 cards 0.79 against 0.99. In play at 40 cards (100 deals, ±0.06-0.09;
the current Insane with the tracker in the last row):

| Model | x8 | Hard | shark | xB | the current Insane |
|---|---|---|---|---|---|
| network | 0.46 | 1.67 | 2.03 | 1.56 | 1.47 |
| network, temperature 2 / 3 | 0.49 / 0.52 | 1.50 / 1.66 | 2.10 / 2.08 | 1.57 / 1.65 | 1.53 / 1.58 |
| half network, half formula (`netMix=0.5`) | 0.63 | 1.84 | 2.07 | 1.82 | 1.50 |
| 0.3 network | 0.59 | 1.92 | 2.13 | 1.88 | 1.38 |
| the formula (the current Insane) | 0.60 | 2.19 | 2.23 | 1.83 | 1.00 |

So it beats the formula head to head by a wide margin but is weaker against the others: the first data had an
Insane in 4 of every 13 seats, and the value of a position depends on how the others will play.

**20 cards: used.** A network trained on 60,000 20-card games (net 3) blended half and half with the formula is better
than the formula against every opponent (150 deals, ±0.06-0.07), and from the other side it closes the hole two
Insanes left for the third player (lower is better there):

| 20 cards | x6 | x7 | Hard | shark | xB | the formula Insane | x6 vs 2x | x7 vs 2x | Hard vs 2x | shark vs 2x | xB vs 2x |
|---|---|---|---|---|---|---|---|---|---|---|---|
| the formula (seventh round) | 1.60 | 1.40 | 2.42 | 1.89 | 1.96 | 1.00 | 0.61 | 1.28 | 0.59 | 0.32 | 0.86 |
| network alone | 1.60 | 1.75 | 2.32 | 2.07 | 1.97 | 1.37 | | | | | |
| **half network, half formula (used)** | **1.96** | **1.89** | **2.41** | **2.15** | **2.05** | **1.30** | **0.55** | **0.70** | **0.33** | **0.21** | **0.48** |

So the 20-card settings have `net: 3, netMix: 0.5`. Three tests that pin the formula's own margins (fifth and sixth
round) now run with `net: 0`; with the network, Insane buys the horse back in `horse60` either way and sells the cat in
`cat20` (where the formula with `mDecP` and `own` buys).

**40 cards: not yet.** A second network on 80,000 games (net 2; the first one's bot in the pool and more Hards and
others) predicts a little better (0.756) and, blended half and half, beats the current Insane 1.42 and the
third-round one 1.58, holds x8 alone to 1.75 (the current Insane: 2.44), but two of it leave a lone Hard 0.72 (0.21)
and a lone xB 0.88 (0.58), and it gets 1.91 against two Hards (2.09). It starts far more koehandels than the formula
(138 against 83 in 30 games against two Hards) and bids higher (average limit 132 against 117): its other settings
were tuned for the formula.

**40 cards: used, with its own settings.** Retuned for it (`runs/t9.jsonl`, C++ tune5, 14 generations, with a new
worst-case fitness `FIT=soft:0.1`: every table is its own duplicate match and the fitness is a soft minimum of the
gains over them, so a gain on one table cannot buy a loss on another; the tables: two each of x8, Hard, shark, xB,
Insane, and one each of x8, Hard, xB alone against two). The result (`runs/t9.final.txt`) went to three edges: a fifth
network (netMix 0.2) at temperature 2.17, koehandels only when clearly better than an auction (khBias -0.6), and bids
that follow how keenly the others bid (shadeK -1), shade 1.04, mDec 0.104. On 150 new deals (±0.05-0.07; the same
deals for every row), against two of each and, on the right, one of each alone against two of it (lower is better):

| 40 cards | x8 | Hard | shark | xB | the previous Insane | `ins7` | Hard vs 2x | xB vs 2x | x8 vs 2x |
|---|---|---|---|---|---|---|---|---|---|
| the previous Insane | (0.66) | (2.09) | (2.21) | (1.77) | 1.00 | (1.34) | 0.25 | 0.64 | 2.38 |
| formula with khBias -0.6 | 0.59 | 1.97 | 2.47 | 2.05 | 1.19 | 1.44 | 0.16 | 0.43 | 1.70 |
| **the network with its settings (used)** | **0.81** | **2.11** | **2.52** | **2.06** | **1.80** | **1.68** | **0.19** | **0.46** | **0.86** |

(in brackets: 200 other deals.) The restraint alone explains part of it; the network adds the rest, above all
against the hoarder: x8 alone against two Insanes drops from 2.38 to 0.86. So the full-deck settings are now
`net: 2, netMix: 0.2, netT: 2.17, khBias: -0.6, shade: 1.04, mDec: 0.104, shadeK: -1` (the 20-card ones unchanged:
`small` keeps `netT: 1, shadeK: 0`); the previous Insane is frozen as `ins8` in `specs2.json`.

**The next hole: a money hoarder (`x9`).** A counter-strategy search against the new Insane (`runs/x9.jsonl`: pairs of
candidates against one Insane, from `ins8`, stopped after 7 generations once it had settled) found a bidder that
offers about half of what its model would pay (shade 0.5), almost never starts a koehandel (khBias -0.6), weighs
animals more (rho 1.5) and keeps its money for the koehandels at the end (`runs/x9.final.txt`, `x9` in specs2.json).
On 150 new deals Insane gets 0.51 against two of it (the previous Insane 0.14), 0.33 when they count as people (then
it starts koehandels against them, into their money), and one x9 alone gets 1.37 against two Insanes and 2.07
against two Hards: a strong style, not a trick, and not unlike how the person above collected animals cheaply. A
likely leak: shadeK -1 makes Insane bid above its limit when the others bid low. It is in the `solo` tune's field
(`runs/t11.jsonl`) and in the next data (`data/d40e`).

A network that also reads how each player has played so far (net 4, `STYLE=1`: keenness and buy-back rate, from the
public history, 40,000 games) predicts a little better (0.750 against 0.756) but plays worse: blended half and half,
0.86 against the current Insane, 1.68 against Hard (x8 0.84, shark 2.15, xB 1.81; alone against two of it Hard 0.59,
xB 0.93, x8 1.61; 80 deals). In simulated games those numbers mostly tell which bot sits there, so it learns about
those bots rather than about styles; not used.

**The card tracker against people.** In a person's 40-card game Barnaby believed the person held 200 when they held
50 and, by the end, 1320 when they held 90. Two causes. Deals between others are ambiguous (nobody sees the amounts),
and the tracker's offers prior was fitted on bots, who offered 39% of their money on average in the logged games;
the person offered 79%, often everything. So: (1) the tracker learns each player's boldness from the offers it sees in
its own deals (BOLDAT: 60% of their money counts as bold), with a prior that is high for people (BOLDH 0.7; everyone at
the table sees who is a bot) and none for bots; a bold player's offers are weighted partly by how close they come to
the most they could put down; (2) every total a side could put down counts once, however many sets of cards make it
(`sums`; a player picks an amount and then cards for it, and otherwise the many middling sets outnumber the few near
the top). On that game the error after every move falls from 298 to 176 and the real hand stays among the guesses in
214 of 274 moves (173 before); the 20-card games against people stay as they were (errors 3-6), and with bots alone
it is about level (`scripts/esterr.mjs` at 40 cards, deck empty: 127 against 120 with hoarders, 122 against 130 with
Hard and shark). `rebuild.mjs` has `TRACK=all` (every bot's tracker on every person, summed up) and `TRK=` for trying
settings on logged games.

**Smaller things.** Insane takes at least a second for every move (thinking comes on top) and bids half a second
after the last bid, so people can follow (`think: 1000`, `react`, `bidGap` in `lib/bots/index.js`). The C++ network
layers run on transposed weights with the inner loop over the outputs, which vectorises without changing the order of
any sum (a 40-card game with the network: 1.28 s instead of 2.7 s; still move for move the JS). In JS, with the
tuner loading every core, Insane's slowest move in a 40-card game with the network took 0.8 s (`scripts/movetime.mjs`:
time per decision), inside its one-second floor. A paused table is now kept for 3 hours (it expired after 10 minutes
when the browser stopped polling from a hidden tab, so its heartbeat stopped).

**A person against two 20-card Insanes** (`games/s6vcb3`, the person won 6360 to 4320 and 2460). The person ended with
four sets to their three: sheep and mule at auction for 30+40 and 50+70, cow and duck by koehandel. What went wrong:
Buttercup sold the second mule (completing the person's pair) for 70 rather than buy it back (its model: 0.68 against
0.41); Hazel sold the person its second horse for 70, bought it back by koehandel for 150 when the person had 70 (its
tracker allowed for a 100 note the person had in fact paid to Buttercup), and its model saw no cost in giving the
leader money (win chance 0.191 whether it paid 0 or 110), but that money took the cow from Buttercup, who had spent
280 on a pig to beat every counter Hazel could make. Twice a bot's own model preferred taking the person's animal by
koehandel to an auction (Hazel and the horse, 1.12 against 1.08) and the 20-card `khBias` (-0.19) talked it out of it.
With the formula alone (no network) the bots would have made almost the same moves (`rebuild.mjs` with
`insane:small.net=0`; the mule would have gone to 100). Dropping the koehandel restraint does not pay against bots (20
cards, 150 deals: x6 1.87, x7 1.78 (adopted 1.96, 1.89), Hard 2.39, shark 2.13, xB 2.00; alone against two: Hard 0.31,
xB 0.47, x7 0.77 (0.70)): it is what holds the hoarders, who collect animals much like that person. `rebuild.mjs`
now also replays games where someone let a turn run out.

**Reading habitual acceptors** (`th.habitsA`, `th.habitsAll`, used). As attacker Insane offered what an equilibrium
defender would answer, so a player who just accepts every offer was paid more than needed. Whether a defender
accepted or countered is public, so `habitsAll` counts every koehandel the defender answered (not only one's own;
the size of a counter is only known in one's own deals, otherwise taken as a share of the defender's money) and the
solver mixes that habit into its prediction of the answer, but only for a player who mostly accepts (none at half
the time or less, with a prior of one accept and two counters; a version without that gate lost a little against
x8 and Insane, who counter). At 40 cards (120 deals, same deals): against two of a Hard that accepts 90% of offers
2.47 (2.42), an Insane that accepts 90% 1.58 (1.41), 60% 1.21 (1.23), x8 0.62 (0.61), Insane 1.00; at 20 cards level
everywhere (few koehandels per game). `acceptP` makes any bot such an acceptor (simulations only). In the logged
games people accepted 6 of 15 offers and Insane 1 of 23, so against the people seen so far the gate stays shut.

**A bigger network does not predict better.** Twice as wide (64/64/128): 0.7865 against 0.7876 on the same 30,000
games, so the limit is the data (and the outcome's own noise): the next step is more games, with the newest bots in
them. Each type also reading its player's money and the money of the two players holding the most other copies
(`ARCH=c` in train.py, value.js and brain.h; who wins a split type depends on that money) is being trained; the JS
matches PyTorch (4e-9). (With only its own money and the richest other player's in the type network, `ARCH=a`: 0.7872
against 0.7876, at 20 cards 0.7939 against 0.7932.)

**Bold attackers.** People offered 79% of their money in koehandels, often everything; `boldP` makes a bot offer its
whole hand that often (simulations only). Insane takes them apart: against two Hards that do it 70% of the time 2.90,
two previous Insanes 2.89 (the previous Insane: 2.98, 2.54). `person` in `specs2.json` is a rough stand-in for people
(Hard's judgement, a strong personality, bold half the time, accepts 35% of offers, some noise and slips), for the
final test's table: Insane against two people. `th.person` marks a seat as a person in simulations (C++ `Game.person`,
JS `s.people`, as live tables mark them), so what the bots do differently against people (the card tracker's prior
for bold offers, `khBiasP`) can be tested there too; JS and C++ still play move for move.

**Koehandel restraint against bots only (`khBiasP`).** The restraint (khBias -0.6 at 40 cards) was tuned with tables
of two Insanes against one opponent, where Insanes fighting each other feed the third player; with one Insane against
two others it costs (150 deals, the same as above, khBias 0 against -0.6): two `person`s 2.87 (2.86), a person and a
Hard 2.28 (2.21), two Hards 2.17 (2.11), two x8 0.92 (0.81) (khBias -0.3: 2.90, 2.19, 2.11, 0.81). Live, the bots
know which seats are people, so `khBiasP` is the restraint for a koehandel against a person (khBias stays for bots).
With the `person` stand-ins marked as people (150 deals): `khBiasP=0` 2.90 against two of them (2.86), 2.25 against a
person and a Hard (2.21), and a person alone against two such Insanes 0.03 either way; eager (`khBiasP=0.15`) is bad:
2.28, 1.61, and 0.20 for the lone person. The regret audit agreed (against two `person`s nearly every clearly wrong
turn choice was an auction where a koehandel was better). **But against strong players it costs**: with x9, x8,
Hard, xB and the previous Insane marked as people (150 deals), no restraint gave 0.64, 1.16, 2.14, 1.94 and 1.17
against 0.77, 1.18, 2.12, 2.09 and 1.84 unmarked (with the restraint): a player who answers koehandels well takes the
money. The `person` stand-in is far weaker than real people, so with the full deck the restraint stays
(`khBiasP: -0.6`, as for bots); with 20 cards it is off (`small.khBiasP: 0`, 2.57 / 2.42 against 2.54 / 2.36 with
it), which is what the person in the 20-card game missed: the bots let animals they could take go.

**Settings for a table of people (`th.solo`).** More generally, a bot's best play depends on who else sits at the
table: several Insanes must not feed the others by fighting each other, a lone one can play for itself. `th.solo`
holds the settings used when all the others are people (the final test: one Insane against two people), on top of
the deck-size blend; `solo.k=v` in a spec sets one. They are tuned on tables of one Insane against two opponents
marked as people (`x8:person=1`, ...), where nothing else changes, while the other settings keep the tables with
other bots (`runs/t11.jsonl`: solo khBias, shade, shadeK, mDec, netMix and netT, worst-case fitness over x8, Hard,
xB, `person` and `ins8`).

### Analysing games against people

Every game is logged in full (hidden cards and secret amounts included, player tokens left out). Run locally, the
server rewrites `games/<room>-<game>.json` on every change (`python app/local.py` shares that folder with the repo;
it is gitignored). Hosted, each finished game is also kept in Redis for 30 days (one call per game);
`node agent/scripts/fetchlogs.mjs` downloads them into `games/` (it needs the Redis credentials, for example from
`vercel env pull .env.local`). `node agent/scripts/replay.mjs games/<file>.json` prints a game as a story with
everyone's real money after each deal; `WHY=1 node agent/scripts/rebuild.mjs games/<file>.json` replays it on the
engine and shows what the bots would do at every point and why (see its header for more options, and for saving a
situation as a test fixture). `scripts/repro20.mjs` rebuilds the situations above as tests.

## Ideas for whoever continues

The current architecture has three layers: a hand-made position model (who is likely to win), one-step
predictions of the others' moves (bids, buy-backs), and a game-theoretic solver for koehandels. The biggest gains
left are structural:

1. **Belief tracking with the solver as the model of play.** Poker bots track a "range" for each opponent by asking,
   for every hand they might hold, how likely their actual actions were under the strategy being played. The card
   tracker (`lib/bots/tracker.js`, now available to Insane as `th.track`) keeps guesses of every hand through every
   public event, with a fixed rule of thumb for how offers are built; its estimates beat the regression-based
   ledger against every kind of opponent at 20 cards (`scripts/esterr.mjs`), but in play it is about even (see the
   fifth round). The next step is to weigh guesses after a koehandel between others by how likely the solver's
   equilibrium (or the player's own habits) makes those card counts and that winner.
2. **Endgame search.** Once the deck is empty the game is a finite sequence of koehandels. Playing it out with the
   first-generation bots (`scripts/endgame.mjs`) was too slow and noisy; a small model of the endgame
   (`scripts/endmodel.mjs`: the richer side wins, the winner pays the loser part of its money, the real score at
   the end) was neutral once the position model weighed money more towards the end of the deck. What might still
   help: solved koehandels as the chance nodes instead of "the richer side wins", and averaging over the last few
   cards of the deck so it also guides the last auctions.
3. **Auctions as a game too.** The English-auction rule is right for a bidder with known values, but here the
   auctioneer can buy back, so bids also set the price the auctioneer pays, and bids reveal money. Solving the
   auction (bidder limits and the auctioneer's buy-back threshold as strategies over hidden money) as the solver
   does for koehandels would remove the last hand-tuned piece (`shade`). The robustness check hints at this: a
   much keener solver bot (+40% bids) holds its own against Insane (0.91 ±0.13).
4. **A learned correction instead of a learned evaluation.** The network predicted winners better but decided
   worse. Train a small residual on top of the position model, on targets that are decisions rather than outcomes
   (for example from Insane self-play: which of two positions after a decision did better), so the money-versus-
   animals trade-off is learned directly; or fit the model's parameters per game phase.
5. **Opponent types instead of point adaptation.** A prior over a few styles (keen bidder, bluffer, caller,
   beginner, hoarder) and a posterior from the history the engine already keeps; the solver then plays against the
   mix. `th.openHist` (buy-backs) is the first piece of this that works; adapting predicted bid limits per player
   did not (`th.adapt`). The counter-strategy search (`x5a`, `xA`, `xB`) is a good way to find the styles that
   matter: run it again against every new Insane and add what it finds to the tuning field (it is how the hoarder
   was found).
6. **Offline equilibrium tables.** Run counterfactual regret minimisation offline over abstracted koehandel
   situations to get better and faster strategies than 80 rounds of fictitious play at decision time.
7. **A C++ simulator for the experiments.** Every experiment here is bound by compute (tuning, counter-strategy
   searches, gauntlets, regret audits). A port of the engine and the bots to C++ (g++ -O3; the live bots stay in JS)
   would run them several times faster; the JS stays the reference, and `scripts/golden.mjs` (a hash of every move
   in fixed-seed games) checks the port move for move. Profile first (`node --cpu-prof`): the koehandel solver took
   about 75% of Insane's time (plus 19% garbage collection) until its loop was rewritten without allocations (the
   same hash, 3-6 times faster); after that it is still the largest part.

**Next steps from the eighth round**: **see ">>> PICK UP HERE <<<" at the top**, which supersedes the first three
items below (they are kept for the record):
- 40 cards: done (`runs/t9`, used). Next: the counter-strategy search against it (`runs/x9`, from `ins8`, `vs:insane`)
  and a retune with what it finds in the field, this time with the formula's own numbers (delta, tau, mu, ...) among
  the parameters too (a fifth network, four fifths formula, and those numbers date from the third round).
- 20 cards: the same retune for the 20-card network's decision settings (`runs/t10`, worst-case fitness over x6, x7,
  Hard, shark, xB, Insane and x7/Hard/xB alone against two).
- The next network: `data/d40d` (the network bot and random personalities in the pool) and `d40e` (the new Insane in
  the pool); train on them together (`HALF=1` keeps 5 million rows on the GPU), retune, verify.
- The style network (net 4) plays worse (see above); styles might still help with far more kinds of opponents in the
  data (random personalities rather than a few fixed bots), so that style is not a stand-in for the bot's name.
- The AlphaZero loop: generate the next data with the newest bot in the pool (`datagen.exe`, a weighted pool), retrain,
  export, retune, repeat; a bigger network or more data per round once the gains per round shrink.
- Speed for live play: a 40-card game with the network takes 2.7 times as long in C++; in JS the per-call cost is
  dense loops over Float64Arrays (`lib/bots/value.js`); typed flat weights and fewer allocations in `util` if moves get
  slow on the hosted server.
- Card tracker: fit BOLDH/BOLDAT on more games against people (`TRACK=all TRK=... rebuild.mjs games/*.json`); deals
  between others stay ambiguous, so the tracker's spread may still be too narrow late in 40-card games.
- Record the new `scripts/golden.mjs` hash; update the summary table at the top with the eighth round.

**Next steps from the seventh round** (long runs in C++, `agent/cpp`; the final test is a 40-card game of two people
against one Insane, so 40 cards come first):
- 40 cards: the t8 retune was verified and is a trade (see above: x8 fixed, Hard and xB worse); retune again with
  more deals per field entry (60+) or a worst-case fitness, adopt only a result level or better everywhere, then
  run the next counter-strategy search against it (`vs:insane` at 40 cards, as for x8, with wider ranges: x8 ended
  at the edges) and retune with that in the field; repeat while it finds holes (league training).
- 20 cards: retune with x6 and x7 both in the field, the other-side tables `vs:x6;vs:x7;vs:ins6`, and `shadeK` among
  the parameters (any fixed bidding level leaves a pair of Insanes open to the opposite style; shadeK lets the bid
  follow how the table bids).
- Two Insanes at one table still drive each other's prices up for the third player; beyond shadeK, try seats that
  differ more (personalities) or a bid limit that counts what the auctioneer gains when the price goes up.
- Turn choices mid and late in the deck (auction against koehandel) are the most error-prone decisions in the regret
  audit; port `audit.mjs` to C++ and run it on many more games before acting on it.
- The card tracker's prior for others' koehandel offers was fitted on bots; fit it on the people's game logs
  (`games/`), and port `esterr.mjs` / `calib.mjs` / `splits.mjs` to C++.
- `scripts/golden.mjs` hashes change with every change in play (the seventh round's 20-card settings and the tracker
  changed them); record the new hash after each accepted change.

Smaller items: finish the 20-card tuning with the hoarders in the field (`runs/t5c.jsonl` was stopped after 3
generations) and retune the 40-card settings the same way (they still date from the third round); tune for 4-5
players separately; check the better turn choice at 40 cards (it is on for 20 cards and blended out by 30, untested
beyond); measure the levels against real people with the game logs (`games/`); Easy beats the novice stand-in at
20 cards (1.69) more than at 40, so it may be too strong for beginners in small games; remove the unused
`th.adapt`/`habitsA`/`kappa` switches if they stay off. From the sixth round: a calibrated win chance (the soft win
chance gives a hopeless player 15%; a chance from each player's expected score and its spread, which shrinks as the
game settles, would end the kingmaking at the root rather than through `own`); valuing a split pair by what winning it
later costs (the goat above); finish testing `softCap`; and measure from the other side (one player against two
Insanes, as people play them) as well as Insane against two of each.
