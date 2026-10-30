#!/bin/sh
# Eleventh round: the Insane rows of regress.sh for a candidate (C="insane:deltaPoor=1.35"), to compare with
# runs/regress10.txt (the current INSANE).
G=./agent/cpp/gauntlet.exe; D=${D:-100}; C=${C:-insane}
for t in "3 40" "3 20" "3 30" "3 25" "4 40" "5 40" "4 20" "5 20"; do set -- $t
  $G "$C" "hard;xB;shark" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"
  $G "$C" "ins8;insB" $D $1 $2 2>&1 | tail -1 | sed "s/^/[$1p $2] /"
done
echo done
