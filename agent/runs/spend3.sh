#!/bin/sh
# Eleventh round, part 3: khPoor against people only (spend2: against bots it cost head to head 0.83 and shark 2.56).
# Measured from the other side, as people meet Insane live: one player alone against two Insanes (lower is better).
G=./agent/cpp/gauntlet.exe
for c in "hard:person=1" "person" "x9:person=1" "x8:person=1" "hard:shade=1.5,person=1" "hard:shade=2,person=1"; do $G "$c" "insane;insane:khPoor=2" 150 3 40 2>&1 | tail -1; done
echo done
