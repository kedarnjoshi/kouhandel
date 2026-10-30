#!/bin/sh
# Ninth round: a candidate Insane on 150 deals against everything a person might be: the bots, realistic price-pushers,
# a soft gang, and opponents marked as people (the final test's code paths: khBiasP, the tracker's prior for people).
#   sh agent/runs/verify9.sh "insane:<settings>" > agent/runs/verify9.<name>.txt
G=./agent/cpp/gauntlet.exe
$G "$1" "x9;x8;hard;xB;shark;insane;hard:push=1,pushSd=0.15;x9:push=1,pushSd=0.15;hard:gang=0.3;x9:person=1;hard:person=1;person" 150 3 40 2>&1 | tail -1
