#!/bin/sh
# deltaPoor (prototype in C++ only): money's late weight rises only while poorer than the richest other. Why: the
# deltaEnd sweep (money2/money3) gains against hoarders, where Insane enters the endgame poorest, and costs against xB,
# where it enters richest (1417 against ~700). 100 deals, same deals as money2/money3.
G=./agent/cpp/gauntlet.exe
for c in deltaPoor=1.35 deltaPoor=1.7 "deltaEnd=0.8,deltaPoor=1.5"; do $G "insane:$c" "x9;x8;hard;xB;shark;insane" 100 3 40 2>&1 | tail -1; done
