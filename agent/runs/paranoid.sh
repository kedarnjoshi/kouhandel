#!/bin/sh
# paranoid (C++ prototype): Insane predicts the others (bid limits, koehandel answers) as if they played together
# against it. Against a (soft) gang it should help, against selfish players it mispredicts. 100 deals.
G=./agent/cpp/gauntlet.exe
$G insane:paranoid=1 "hard;x9;insane;hard:gang=0.3;hard:gang=1;hard:push=1,pushSd=0.15" 100 3 40 2>&1 | tail -1
