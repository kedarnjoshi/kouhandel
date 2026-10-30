#!/bin/sh
# Strategies people may use against one Insane that no bot has tried (C++ stand-ins, simulations only):
#   gang: both others play for either of them to win (utility = their summed win chances): no bidding wars between
#         them, pushing Insane, attacking it
#   push: bids up to push x Insane's limit (with noise pushSd) minus 10, so that it pays its limit (a person who
#         learned how far Insane goes)
# Baselines (money2/money3, same deals): hard 2.12, x9 0.77, insane 1.00
G=./agent/cpp/gauntlet.exe
$G insane "hard:gang=1;insane:gang=1;x9:gang=1;hard:push=1;hard:push=1,pushSd=0.15;x9:push=1;insane:gang=1,push=1" 100 3 40 2>&1
