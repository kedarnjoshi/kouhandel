#!/bin/sh
# th.adapt (predicted bid limits follow each player's measured keenness) against the hoarders found since (x8, x9)
G=./agent/cpp/gauntlet.exe
for v in 4 10; do $G "insane:adapt=$v" "x9;x8;hard;xB;insane" 100 3 40 2>&1 | tail -1; done
for o in x9 x8; do $G $o "insane:adapt=4" 100 3 40 2>&1 | tail -1; done
