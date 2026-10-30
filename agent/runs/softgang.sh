#!/bin/sh
# A soft gang (two people who would rather the other person won than the bot): own chance + g x the partner's
# (gang=1 is the full gang of gang.txt). 100 deals.
G=./agent/cpp/gauntlet.exe
$G insane "hard:gang=0.3;hard:gang=0.5;x9:gang=0.3;hard:gang=0.3,push=1,pushSd=0.15" 100 3 40 2>&1 | tail -1
