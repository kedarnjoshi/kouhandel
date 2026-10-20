"""Bradley-Terry ratings (Elo scale, Random = 0 if present) from a ladder file written by ladder.mjs.
python agent/scripts/bt.py agent/runs/ladder-x.json [players filter, e.g. 3]
Every pair of seats in a game is one comparison: the higher score wins it (equal scores count half each)."""
import json, sys, math
from collections import defaultdict
games = json.load(open(sys.argv[1]))
only = int(sys.argv[2]) if len(sys.argv) > 2 else 0
W = defaultdict(float); N = defaultdict(float); names = set()
for g in games:
    if not g.get('done', True): continue
    s, seats = g['scores'], g['seats']
    if only and len(seats) != only: continue
    for i in range(len(seats)):
        for j in range(i + 1, len(seats)):
            a, b = seats[i], seats[j]
            if a == b: continue
            names.update([a, b])
            w = 1.0 if s[i] > s[j] else 0.0 if s[i] < s[j] else 0.5
            W[(a, b)] += w; W[(b, a)] += 1 - w; N[(a, b)] += 1; N[(b, a)] += 1
names = sorted(names); r = {n: 0.0 for n in names}
for _ in range(500):  # minorize-maximize
    new = {}
    for a in names:
        wins = sum(W[(a, b)] for b in names if b != a) + 0.5
        den = sum(N[(a, b)] / (math.exp(r[a]) + math.exp(r[b])) for b in names if b != a and N[(a, b)]) + 1 / (math.exp(r[a]) + 1)
        new[a] = math.log(wins / den)
    m = new.get('random', sum(new.values()) / len(new)); r = {a: v - m for a, v in new.items()}
for a in sorted(names, key=lambda x: -r[x]):
    print(f'{a:>24} {400 / math.log(10) * r[a]:7.0f}   ({int(sum(N[(a, b)] for b in names))} pairs)')
