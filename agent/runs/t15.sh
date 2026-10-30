#!/bin/sh
# t15 (ninth round): Insane's money settings and their neighbours, tuned for the worst table (soft minimum of the
# gains on the current Insane) in a field of everything a person might be: hoarders (x9), x8, Hard, xB, shark, the
# current Insane, realistic price-pushers (Hard and hoarders who learned Insane's limits, 15% noise) and a soft gang.
# Why: deltaEnd moves the worst tables by 0.3-0.5 (money3, pushmoney) with a real trade against Hard/xB/shark, and
# delta/muEnd/shade will move with it; paranoid gained 0.16 against x9 (paranoid.txt). Starts at deltaEnd 1.8 (best
# region 1.35-2.2, money3/money5).
FIT=soft:0.1 DEALS=24 LAMBDA=10 SIGMA=0.25 SEED=23 START="deltaEnd=1.8,muEnd=1,delta=0.6,shade=1.04,khBias=-0.6,mDec=0.104,paranoid=0.5" \
  ./agent/cpp/tune5.exe t15 10 insane "x9;x8;hard;xB;shark;insane;hard:push=1,pushSd=0.15;x9:push=1,pushSd=0.15;hard:gang=0.3" 40 3 \
  "deltaEnd:0.6:3.5,muEnd:0.2:1.2,delta:0.3:1,shade:0.7:1.5,khBias:-0.9:0.3,mDec:0:0.3,paranoid:0:1"
