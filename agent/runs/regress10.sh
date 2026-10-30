#!/bin/sh
# Tenth round: the Insane rows of regress.sh again with softCap and capSure in INSANE (compare with runs/regress.txt).
G=./agent/cpp/gauntlet.exe; D=${D:-100}
for t in "3 40" "3 20" "3 30" "3 25" "4 40" "5 40" "4 20" "5 20"; do set -- $t
  $G insane "hard;xB;shark" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"
  $G insane "ins8;insB" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"
done
