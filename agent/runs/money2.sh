#!/bin/sh
# The hoarder hole is in the endgame koehandels (Insane offers too little while holding ~1300): money counting more
# late (deltaEnd above delta, muEnd below 1, as x9's own tuned values), 100 deals
G=./agent/cpp/gauntlet.exe
for c in "insane:deltaEnd=1" "insane:deltaEnd=1.35" "insane:muEnd=0.3" "insane:deltaEnd=1.35,muEnd=0.3"; do $G "$c" "x9;x8;hard;xB;insane" 100 3 40 2>&1 | tail -1; done
