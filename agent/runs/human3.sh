#!/bin/sh
# Tenth round, part 3: softCap (human1: level or better everywhere, and alone it fixes the logged game's broken limits:
# cow 20 -> 190, cow 60 -> 280, 4th mule 10 -> 170) with capSure (a counter never above what surely beats the
# attacker's money: Gus's 1410 against an offer of at most ~330 -> 500), and capSure alone (mDecW lost in human2).
G=./agent/cpp/gauntlet.exe
for c in "insane:softCap=1,capSure=3" "insane:capSure=3"; do $G "$c" "x9;x8;hard;xB;shark;insane;hard:person=1;person" 100 3 40 2>&1 | tail -1; done
