# How well does the hand-made model (lib/bots/brain.js, Model.util with no change) predict who wins? The same rows
# and validation games as train.py, with everyone's real money; settings: Insane's full-deck ones, or env TH (json).
#   python agent/value/baseline.py <data.bin> [more.bin ...]
import json, os, sys
import numpy as np
from train import load, N, NT, VAL, ROW

MULE_PAY = [50, 100, 200, 500]
TH = dict(tau=1.432, tau1=68.93, rho=1.289, gamma=1.106, delta=0.6, mu=508.3, muScale=1, muEnd=1, deltaEnd=0.6)
TH.update(json.loads(os.environ.get('TH', '{}')))


def probs(a, th=TH):
    R = len(a)
    deckSize, deckLeft, mules = a[:, 0], a[:, 1], a[:, 2]
    left, counts = a[:, 4:4 + NT], a[:, 4 + NT:4 + 2 * NT]
    P = a[:, 4 + 2 * NT:4 + 2 * NT + N * (NT + 3)].reshape(R, N, NT + 3)
    herd, money, out = P[:, :, :NT], P[:, :, NT], P[:, :, NT + 2]
    alive = out < 0.5
    m = np.maximum(1, alive.sum(1))
    pool = money.sum(1)
    mleft = np.zeros(R)
    for k in range(4):
        idx = (mules + k).astype(int)
        pay = np.where(idx < 4, np.array(MULE_PAY + [0] * 5)[np.minimum(idx, 8)], 0)
        mleft += np.where(k < 4 - mules, pay * np.clip(left[:, 3] - k, 0, 1), 0)
    mu = th['mu'] * np.ones(R)
    if th.get('muScale'): mu = mu * (pool / m + mleft) / 940
    lf = np.where(deckSize > 0, deckLeft / np.maximum(deckSize, 1), 1)
    mu = mu * (th['muEnd'] + (1 - th['muEnd']) * lf)
    delta = th['deltaEnd'] + (th['delta'] - th['deltaEnd']) * lf
    share = th['rho'] * left / m[:, None]                                  # [R, NT]
    b = np.minimum(herd, 5) + share[:, None, :]
    bp = np.where(b > 0, b, 0) ** th['gamma'] * alive[:, :, None]
    mf = (np.round(np.maximum(money, 0) / 10) * 10 + mu[:, None]) ** delta[:, None]
    s = bp * mf[:, :, None]
    tot = s.sum(1, keepdims=True)
    p = np.where(tot > 0, s / np.where(tot > 0, tot, 1), 0)
    A = (p * VAL).sum(2); B = p.sum(2); C = (p * p * VAL).sum(2)
    E = A * B - C + A
    mean = (E * alive).sum(1) / m
    itau = 1 / (th['tau'] * (mean + th['tau1']))
    z = np.where(alive, (E - E.max(1, keepdims=True)) * itau[:, None], -1e9)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


if __name__ == '__main__':
    a = load(sys.argv[1:])
    o = 4 + 2 * NT + N * (NT + 3)
    wins, seed = a[:, o:o + N], a[:, o + 3 * N]
    games = np.unique(seed)
    rng = np.random.default_rng(1)
    val_games = set(rng.choice(games, size=max(1, len(games) // 10), replace=False).tolist())
    vm = np.array([s in val_games for s in seed])
    p = probs(a)
    ll = -(wins * np.log(np.maximum(p, 1e-9))).sum(1)
    print(f'hand model log-loss: all {ll.mean():.4f}, validation {ll[vm].mean():.4f} (uniform {np.log(N):.4f})')
    for lo, hi in [(0.75, 1.01), (0.5, 0.75), (0.25, 0.5), (0, 0.25)]:
        dl = a[:, 1] / np.maximum(a[:, 0], 1); sel = vm & (dl >= lo) & (dl < hi)
        print(f'  deck {lo:.2f}-{hi:.2f}: {ll[sel].mean():.4f} ({sel.sum()} rows)')
