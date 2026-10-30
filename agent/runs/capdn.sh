#!/bin/sh
# capSd (capsd.txt) draws the limit both ways and overpays against plain bidders (two Insanes 0.83). capDn: only
# downwards, limit x (1 - capDn x uniform): a pusher still risks being left with the animal. 100 deals.
G=./agent/cpp/gauntlet.exe
for c in insane:capDn=0.15 insane:capDn=0.3; do $G "$c" "hard:push=1;x9:push=1;x9:push=1,pushSd=0.15;hard;x9;insane" 100 3 40 2>&1 | tail -1; done
