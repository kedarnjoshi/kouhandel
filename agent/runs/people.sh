#!/bin/sh
# Eleventh round, the owner's target: real tables have people in the majority (2-4 people, 1 Insane), and people
# rarely hoard; they spend, go broke, and collect money again later. So: one Insane against a mixed field of people
# stand-ins (all marked as people): Hard, Hard bidding 1.5x and 2x its limit (spenders), and `person` (bold offers).
# Candidates: cheap buy-backs (mDecP 1: the buy-back margin shrinks with the price), cheap steals by koehandel during
# the deck phase (khBiasP 0: no restraint against people), both, and deltaPoor 1.5 (poor2.txt: best against hoarders).
G=./agent/cpp/gauntlet.exe
P="hard:person=1|hard:shade=1.5,person=1|hard:shade=2,person=1|person"
for c in "insane" "insane:mDecP=1" "insane:khBiasP=0" "insane:mDecP=1,khBiasP=0" "insane:deltaPoor=1.5"; do
  for t in "3 150" "4 100" "5 100"; do set -- $t
    $G "$c" "$P" $2 $1 40 2>&1 | tail -1 | sed "s/^/[$1p] /"
  done
done
echo done
