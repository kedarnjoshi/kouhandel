#!/bin/sh
# Tenth round: fixes for what a person saw in a live game (games/ccafpb-1943540669.json, agent/scripts/explain.mjs).
# Insane refused cheap buy-backs (horse for 30, cow for 50: the fixed 10% margin, mDec) -> mDecP (margin with the
# price); a hopeless Gus countered 1410 against an offer of at most ~470 (kingmaking) -> own; odd low limits where
# the auctioneer is predicted to buy back -> softCap. All three exist in JS and C++ (20-card settings so far).
# 100 deals, the general field plus person-marked tables.
G=./agent/cpp/gauntlet.exe
for c in insane insane:mDecP=1 insane:own=1 insane:softCap=1; do $G "$c" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 100 3 40 2>&1 | tail -1; done
