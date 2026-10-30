#!/bin/sh
# Pushing leaves Insane poorer at the last auction (587 against 1168/1065; without pushing 803 against 1021/995): the
# money settings of money3/poor against the pushers. 100 deals.
G=./agent/cpp/gauntlet.exe
for c in "deltaEnd=2.2" "deltaEnd=0.8,deltaPoor=1.5" "deltaEnd=1.35"; do $G "insane:$c" "hard:push=1;x9:push=1;x9:push=1,pushSd=0.15;hard:push=1,pushSd=0.15" 100 3 40 2>&1 | tail -1; done
