#!/bin/sh
# deltaEnd sweep (README lead 1): how far to turn money's late weight before the xB cost outweighs the hoarder gain.
# 1 and 1.35 are in money2.txt. 100 deals, full CPU, nothing else running.
G=./agent/cpp/gauntlet.exe
for c in deltaEnd=0.8 deltaEnd=1.2 deltaEnd=1.7 deltaEnd=2.2; do $G "insane:$c" "x9;x8;hard;xB;shark;insane" 100 3 40 2>&1 | tail -1; done
