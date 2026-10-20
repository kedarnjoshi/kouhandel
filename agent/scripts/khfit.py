"""Fit the guess of a secret koehandel's net transfer (attacker -> defender) from what onlookers see.
python agent/scripts/khfit.py agent/data/kh/*.json

Compares the engine's current formula with linear fits on richer public features (stakes, both players'
public money estimates, holdings), per case (accepted / attacker wins / defender wins), by cross-validation.
"""
import json
import sys

import numpy as np

rows = []
for f in sys.argv[1:]:
    rows += json.load(open(f))
R = {k: np.array([r[k] if r[k] is not None else -1 for r in rows], float) for k in rows[0]}
net = R['x'] - np.where(R['y'] >= 0, R['y'], 0)  # what the attacker hands over, net
acc = R['nb'] == 0
awin = ~acc & (R['x'] > R['y'])
bwin = ~acc & (R['x'] < R['y'])
avg = R['avg']
own = np.minimum(3 * avg, np.maximum(0, R['ledA']) / np.maximum(1, R['cA']))
ownB = np.minimum(3 * avg, np.maximum(0, R['ledB']) / np.maximum(1, R['cB']))
na, nb = R['na'], R['nb']


def current():
    g = np.where(acc, 0.17 * na * avg + 0.396 * na * own,
                 np.where(awin, 0.159 * na * avg + 0.093 * na * own + 0.164 * nb * avg + 0.08 * nb * ownB,
                          -(0.076 * na * avg + 0.143 * na * own + 0.258 * nb * avg + 0.113 * nb * ownB)))
    return g


stake = R['val'] * R['cnt']
ledA, ledB = np.maximum(0, R['ledA']), np.maximum(0, R['ledB'])
feats = {
    'base': [na * avg, na * own, nb * avg, nb * ownB],
    'rich': [na * avg, na * own, nb * avg, nb * ownB, stake, np.minimum(ledA, stake * 2), np.minimum(ledB, stake * 2),
             na * stake / 100, nb * stake / 100, ledA, ledB, (R['deck'] == 0) * stake],
}


def cv(X, y, mask, k=5, lam=1.0):
    idx = np.where(mask)[0]
    rng = np.random.default_rng(0)
    rng.shuffle(idx)
    pred = np.zeros(len(y))
    for f in range(k):
        te = idx[f::k]
        tr = np.setdiff1d(idx, te)
        A = X[tr]
        w = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ y[tr])
        pred[te] = X[te] @ w
    A = X[idx]
    w = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ y[idx])
    return pred, w


cur = current()
print(f'{len(rows)} deals: accepted {acc.sum()}, attacker wins {awin.sum()}, defender wins {bwin.sum()}')
for name, m in [('accepted', acc), ('attacker wins', awin), ('defender wins', bwin), ('all', np.ones(len(rows), bool))]:
    line = f'{name:14s} mean abs error: guess 0 {np.abs(net[m]).mean():5.0f}  current {np.abs(cur[m] - net[m]).mean():5.0f}'
    for fn, F in feats.items():
        X = np.stack(F, 1)
        if name == 'all':
            p = np.zeros(len(rows))
            for mm in (acc, awin, bwin):
                p[mm] = cv(X, net, mm)[0][mm]
        else:
            p = cv(X, net, m)[0]
        line += f'  {fn} {np.abs(p[m] - net[m]).mean():5.0f}'
    print(line)
for name, m in [('accepted', acc), ('attacker wins', awin), ('defender wins', bwin)]:
    print(name, 'rich weights', np.round(cv(np.stack(feats['rich'], 1), net, m)[1], 3).tolist())
