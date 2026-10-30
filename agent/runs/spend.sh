#!/bin/sh
# (Its khBiasP lines are void: overrides are comma-separated, so "hard:shade=2:person=1" lost person=1; see spend2.sh.)
# Eleventh round: the owner's point that a player who spends everything in auctions collects cards nobody takes back
# (Insane never koehandels while cards are left, khBias/khBiasP -0.6). Spenders (Hard bidding 1.3-2x its limit) alone
# against two Insanes (lower is better for Insane), then Insane without the restraint.
G=./agent/cpp/gauntlet.exe
for c in "hard" "hard:shade=1.3" "hard:shade=1.6" "hard:shade=2"; do $G "$c:person=1" "insane" 150 3 40 2>&1 | tail -1; done
echo done
# part 2: the shade-2 spender against two Insanes without (or with less) restraint against people
for f in "insane:khBiasP=0" "insane:khBiasP=-0.3"; do $G "hard:shade=2:person=1" "$f" 150 3 40 2>&1 | tail -1; done
echo done2
