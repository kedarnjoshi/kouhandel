# Koehandel bots: how they were built

This folder holds the research behind the bots you can add to a table: the training and evaluation scripts, the
raw results and the charts. The bots themselves live in `lib/bots/` and run on the server (none of it ships to
the browser). This page is for whoever works on them next.

## Summary

| Level | What it is | Rating (3-5 players / 3 players) | Win share (fair = 1) |
|---|---|---|---|
| Random | uniformly random legal moves | 0 / 0 (the anchor) | 0.01 |
| Confusing | sensible play with chaotic generosity (see below) | 257 / 474 | 0.23 |
| Easy | the second-generation judgement with beginner habits, calibrated to a novice player | 261 / 554 (novice stand-in: 269 / 537) | 0.44 (novice 0.22) |
| Medium | the same judgement played imprecisely, halfway between Easy and Hard | 419 / 622 | 1.06 |
| Hard | the second-generation judgement: predicts everyone else's moves | 642 / 962 (first-generation Hard: 541 / 858) | 2.12 (first-generation Hard 1.54) |
| Insane | Hard + a game-theoretic koehandel solver + recalibrated model + reading habits + opening bids and money tracking (fourth round) | 665 / 1018 (before the fourth round) | 2.26; at 3 players against two Hards 1.88 with 40 cards, 1.69 with 26, 1.87 with 20 |

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
```

Names are resolved by `scripts/registry.mjs`: levels (`easy` ... `insane`), first-generation bots (`hard0`,
`medium0`, `easy0`, `insane0`), stand-ins (`novice`, `shark`), exploiters (`padder`, `caller`, `keen`, `sniper`,
see `scripts/exploiters.mjs`), variants (`v2:delta=0.6,solve=1`), `peek:<name>` (sees everyone's money, for
experiments) and the candidates in `runs/specs2.json`. Scripts use every core but one.

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

### Analysing games against people

Every game is logged in full (hidden cards and secret amounts included, player tokens left out). Run locally, the
server rewrites `games/<room>-<game>.json` on every change (`python app/local.py` shares that folder with the repo;
it is gitignored). Hosted, each finished game is also kept in Redis for 30 days (one call per game);
`node agent/scripts/fetchlogs.mjs` downloads them into `games/` (it needs the Redis credentials, for example from
`vercel env pull .env.local`). `node agent/scripts/replay.mjs games/<file>.json` prints a game as a story with
everyone's real money after each deal. `scripts/repro20.mjs` rebuilds the situations above as tests.

## Ideas for whoever continues

The current architecture has three layers: a hand-made position model (who is likely to win), one-step
predictions of the others' moves (bids, buy-backs), and a game-theoretic solver for koehandels. The biggest gains
left are structural:

1. **Belief tracking with the solver as the model of play** (the largest lever: perfect money knowledge is worth
   1.50). Poker bots track a "range" for each opponent by asking, for every hand they might hold, how likely their
   actual actions were under the strategy being played. Here: keep a weighted set of hand guesses per opponent and,
   after each koehandel between others (card counts and winner are public), reweight every guess by how likely the
   solver's equilibrium makes those card counts and that winner. The random-subset version (`scripts/tracker.mjs`)
   failed because offers are strategic; the equilibrium is exactly the missing model of how offers are built. Cost:
   one solve per observed koehandel, which can be cached in the table state.
2. **Endgame search.** Once the deck is empty the game is a finite sequence of koehandels. A shallow search over
   whom to attack with which animal next, with solved koehandels as chance nodes and the position model at the
   leaves, would replace the one-step choice where it matters most (most points are decided there). Playing the
   endgame out with the first-generation bots (`scripts/endgame.mjs`) was too slow and too noisy to help; the search
   needs a model of play as good as the bot's own, which is what the solved koehandels would give.
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
   beginner) and a posterior from the history the engine already keeps; the solver then plays against the mix. The
   per-statistic adaptations tried so far were too noisy against bots, but a typed prior is more robust and is what
   matters against people.
6. **Offline equilibrium tables.** Run counterfactual regret minimisation offline over abstracted koehandel
   situations to get better and faster strategies than 80 rounds of fictitious play at decision time.

Smaller items: tune for 4-5 players separately (the recalibration was done at 3 players; smaller decks are now
covered by the money offset); measure the levels against real people with the game logs (`games/`); decide whether
Hard and Medium get the money offset too (they are weaker with smaller decks than they need to be); remove the
unused `th.adapt`/`habitsA`/`kappa` switches if they stay off. A cheaper public guess of secret koehandel amounts
will not help (see above); better inference has to come from modelling each player's play.
