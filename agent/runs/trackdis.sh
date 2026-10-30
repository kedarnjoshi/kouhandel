#!/bin/sh
# Eleventh round: in both LLM games a bot's card tracker collapsed onto a wrong guess (Wilbur's estimate of Gus's money
# 1,305 too high with an sd of 6; the ledger alone was 20 off) and decided the endgame. trackDis k: when the tracker and
# the ledger disagree by more than k combined variances, the tracker's doubt grows by the disagreement and its hands
# are not used for that player.
G=./agent/cpp/gauntlet.exe
for c in "insane:trackDis=4" "insane:trackDis=9"; do $G "$c" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 100 3 40 2>&1 | tail -1; done
echo done
