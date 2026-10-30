#!/bin/sh
# Eleventh round, part 2. spend.txt's person runs were void: "hard:shade=2:person=1" drops everything after the second
# colon (overrides are comma-separated), so the spender was never marked as a person. With the mark the restraint
# works: khBiasP -0.6 or -0.3 -> no deck-phase steals from a spender at all, 0 -> 75 in 20 games (it multiplies the whole
# win chance, so any restraint means never). khPoor k: no restraint against a defender whose money (estimate + k sd) is
# surely below mine. The general field plus two spenders (Hard bidding 1.5x and 2x its limit, marked as people).
G=./agent/cpp/gauntlet.exe
F="x9;x8;hard;xB;shark;insane;hard:person=1;person;hard:shade=1.5,person=1;hard:shade=2,person=1"
for c in "insane" "insane:khPoor=2" "insane:khPoor=1" "insane:khBiasP=0"; do $G "$c" "$F" 100 3 40 2>&1 | tail -1; done
echo done
