#!/bin/sh
# trackDis, part 2. In 12 bot games (TRACKDBG) trackDis 4 fired 150 times in 6,166 estimates: the ledger was closer in
# 144 (mean error 16 against the tracker's 395); 9: 144 times, the ledger always closer. Yet trackdis.txt was flat with
# xB 2.11 -> 1.97: recheck on 300 deals the tables that dipped.
G=./agent/cpp/gauntlet.exe
for c in "insane" "insane:trackDis=9"; do $G "$c" "xB;insane;x9" 300 3 40 2>&1 | tail -1; done
echo done
