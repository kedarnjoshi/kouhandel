#!/bin/sh
# The tracker guard (trackDis 9) on the people tables of people.sh (trackdis2.txt, 300 deals: xB 2.14 -> 2.07, Insane
# 1.00 -> 0.99, x9 0.75 -> 0.75).
G=./agent/cpp/gauntlet.exe
P="hard:person=1|hard:shade=1.5,person=1|hard:shade=2,person=1|person"
for t in "3 150" "4 100" "5 100"; do set -- $t
  $G "insane:trackDis=9" "$P" $2 $1 40 2>&1 | tail -1 | sed "s/^/[$1p] /"
done
echo done
