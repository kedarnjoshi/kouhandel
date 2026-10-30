#!/bin/sh
# stopped after drift=0.5 (worse nearly everywhere); drift removed
# drift (C++ prototype): money counts as it will stand when the deck is empty, by each player's trend so far (money
# gained per card drawn, mules left out, shrunk by drawn/(drawn+10)) times the cards left. Why: pushing and hoarding
# drain Insane during the auctions (587 against 1168/1065 at the last auction) and current money hides the trend. 100 deals.
G=./agent/cpp/gauntlet.exe
for c in drift=0.5 drift=1; do $G "insane:$c" "x9;x8;hard;xB;shark;insane;hard:push=1,pushSd=0.15;x9:push=1,pushSd=0.15" 100 3 40 2>&1 | tail -1; done
