#!/bin/sh
# capR (C++ prototype): the limit at most capR x the highest predicted rival limit (+10). Targets price-pushers (who
# bid far above their own plausible value) without randomness; xB (shade 1.8, a keen bidder) shows the cost. 100 deals.
G=./agent/cpp/gauntlet.exe
for c in insane:capR=1.2 insane:capR=1.5; do $G "$c" "hard:push=1;x9:push=1;x9:push=1,pushSd=0.15;hard;x9;insane;xB" 100 3 40 2>&1 | tail -1; done
