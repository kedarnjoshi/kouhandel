#!/bin/sh
# Price-pushing (gang.txt): two who know Insane's limits and bid it up to just below take Hard 2.12 -> 1.20 and
# hoarders 0.77 -> 0.16. Counter (C++ prototype): capSd, Insane's limit drawn around its value (lognormal) after the
# pushers looked, so pushing risks being left with the animal. Costs: the plain tables. 100 deals.
G=./agent/cpp/gauntlet.exe
for c in insane insane:capSd=0.1 insane:capSd=0.2 insane:capSd=0.35; do $G "$c" "hard:push=1;x9:push=1;x9:push=1,pushSd=0.15;hard;x9;insane" 100 3 40 2>&1 | tail -1; done
