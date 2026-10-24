#!/bin/sh
# Builds the C++ simulator (run from anywhere): sh agent/cpp/build.sh [program ...]  (only those, fast C math only;
# e.g. sh agent/cpp/build.sh gauntlet movelog)
#   movelog.exe                        exact math (ports of V8's exp/log/pow/cos), for the move-for-move checks (check.sh)
#   gauntlet, sprt, tune5, gamespeed   C library math (fast); *_exact.exe: the same with exact math, results equal to the JS
# No -ffast-math/-Ofast and no FMA contraction: every sum stays in the JS order.
# A program still running cannot be overwritten on Windows: the old build is renamed into agent/cpp/old/ and left
# there; each build deletes the ones no longer in use with Windows' own del, which leaves a running program alone
# (MSYS rm would "delete" it by moving it to the Recycle Bin, where it would go on running).
set -e
cd "$(dirname "$0")"
mkdir -p old
if ls old/*.exe >/dev/null 2>&1; then cmd //c "del /q old\*.exe" >/dev/null 2>&1 || true; fi
node levels.mjs 2>/dev/null
F="-O3 -march=native -ffp-contract=off -std=c++17 -pthread"
put() { # put <new file> <target>
  if [ -f "$2" ]; then mv -f "$2" "old/${2%.exe}-$(date +%Y%m%d-%H%M%S)-$$.exe"; fi
  mv -f "$1" "$2"
}
if [ $# -gt 0 ]; then
  for p in "$@"; do
    if [ "$p" = movelog ]; then g++ $F -DKH_EXACT_MATH -o movelog.new.exe movelog.cpp || exit 1; else g++ $F -o $p.new.exe $p.cpp || exit 1; fi
    put $p.new.exe $p.exe
  done
  echo built "$@"; exit 0
fi
g++ $F -DKH_EXACT_MATH -o movelog.new.exe movelog.cpp || exit 1; put movelog.new.exe movelog.exe
for p in gauntlet sprt tune5 gamespeed; do
  g++ $F -o $p.new.exe $p.cpp || exit 1; put $p.new.exe $p.exe
  g++ $F -DKH_EXACT_MATH -o ${p}_exact.new.exe $p.cpp || exit 1; put ${p}_exact.new.exe ${p}_exact.exe
done
g++ $F -o datagen.new.exe datagen.cpp || exit 1; put datagen.new.exe datagen.exe # training data for agent/value
g++ $F -o audit.new.exe audit.cpp || exit 1; put audit.new.exe audit.exe # regret audit (agent/scripts/audit.mjs)
echo built
