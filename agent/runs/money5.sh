#!/bin/sh
# stopped after deltaEnd=3 (past the peak: x8 1.06, Hard 1.75, xB 1.58); the rest goes to the tune t15
# Valuing money more late (deltaEnd) is the answer to pushing as well (pushmoney.txt: deltaEnd 2.2 takes x9-pushers
# 0.20 -> 0.66, x9 0.77 -> 1.19) and the curve had not flattened at 2.2: higher, and with muEnd (money's offset
# shrinks late, also makes money count more). Full field incl. realistic pushers. 100 deals, same deals.
G=./agent/cpp/gauntlet.exe
for c in deltaEnd=3 deltaEnd=4 "deltaEnd=2.2,muEnd=0.5"; do $G "insane:$c" "x9;x8;hard;xB;shark;insane;hard:push=1,pushSd=0.15;x9:push=1,pushSd=0.15" 100 3 40 2>&1 | tail -1; done
