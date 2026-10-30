#!/bin/sh
# Eleventh round: deltaPoor (open work 1) confirmed on the current Insane (softCap, capSure), 150 deals, with the
# person-marked tables. poor.txt (100 deals, before softCap): 1.35 gave x9 0.88, x8 1.43, Insane 1.14.
G=./agent/cpp/gauntlet.exe
for c in "insane" "insane:deltaPoor=1.2" "insane:deltaPoor=1.35" "insane:deltaPoor=1.5"; do $G "$c" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 150 3 40 2>&1 | tail -1; done
echo done
