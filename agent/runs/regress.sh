#!/bin/sh
# Regression check before play-testing (2026-10-24): the new Insane against the previous ones (ins8 mid-round,
# insB = Insane of commit b04edca) on every table shape the app allows (3-5 players, 20-40 cards).
G=./agent/cpp/gauntlet.exe; D=${D:-100}
for t in "3 40" "3 20" "3 30" "3 25" "4 40" "5 40" "4 20" "5 20"; do set -- $t
  for c in insane ins8 insB; do $G $c "hard;xB;shark" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"; done
  $G insane "ins8;insB" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"
done
