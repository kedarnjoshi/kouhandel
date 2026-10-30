#!/bin/sh
# Tenth round, part 2 (after human1): capScan (bid limit: only rivals who can afford the price count; a near-tie no
# longer ends the search: Dolly's cow limit 20 -> 250, Gus's 60 -> 280 in the logged game) and mDecW (buy-back margin
# only in full when the paid bidder has at least average money: mDecP fed the hoarders, x9 0.75 -> 0.54).
G=./agent/cpp/gauntlet.exe
for c in insane:capScan=1 insane:mDecW=1 "insane:capScan=1,mDecW=1"; do $G "$c" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 100 3 40 2>&1 | tail -1; done
