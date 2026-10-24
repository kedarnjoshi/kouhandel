#!/bin/sh
# Plays the same games in JS and C++ and diffs the move logs (agent/cpp/movelog.mjs, movelog.exe from build.sh):
#   sh agent/cpp/check.sh "<spec1;spec2;...>" <deck size> <first seed> <games>
# Prints "same" or the first lines that differ. Run from the repository root.
L="$1"; Z="${2:-20}"; S0="${3:-1}"; G="${4:-10}"
T="${TMPDIR:-/tmp}/khcheck.$$"; mkdir -p "$T"
node agent/cpp/movelog.mjs "$L" "$Z" "$S0" "$G" 2>/dev/null > "$T/js.txt"
./agent/cpp/movelog.exe "$L" "$Z" "$S0" "$G" > "$T/cpp.txt"
if cmp -s "$T/js.txt" "$T/cpp.txt"; then echo "same: $L @$Z seeds $S0..$((S0 + G - 1)) ($(wc -l < "$T/js.txt") lines)"; else
  echo "DIFFER: $L @$Z seeds $S0..$((S0 + G - 1))"; diff "$T/js.txt" "$T/cpp.txt" | head -8; fi
rm -rf "$T"
