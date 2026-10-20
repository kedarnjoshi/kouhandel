# Learn a value function (who wins from here) from self-play positions written by datagen.mjs.
# python agent/scripts/value_train.py <data.jsonl> [out.json] [epochs]
# Every player at the table is described from the observer's side; the same small network scores each player, a
# softmax over the players gives the win chances. An extra head predicts who ends up with each set (more signal per
# game). Compares the log loss with the current hand-made model (the "base" column of the data).
import json, sys, math, random, os, copy
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F

path = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else 'value.json'; epochs = int(sys.argv[3]) if len(sys.argv) > 3 else 12
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
NP, NT, NF = 5, 10, 0

def feats(r, i):
    n = r['n']; v = r['views'][i]; herd = np.array(r['herd'], dtype=np.float32) / 4; rem = np.array(r['remain'], dtype=np.float32) / 4
    money = np.array(v['money'], dtype=np.float32); sd = np.array(v['sd'], dtype=np.float32); cards = np.array(r['cards'], dtype=np.float32)
    X = np.zeros((NP, 57), dtype=np.float32); mask = np.zeros(NP, dtype=np.float32)
    order = [(i + d) % n for d in range(n)]  # observer first, then in seat order
    for slot, j in enumerate(order):
        others = [x for x in range(n) if x != j]
        oh = herd[others]
        row = np.concatenate([herd[j], oh.max(0), oh.sum(0), rem,
            [money[j] / 500, math.log1p(money[j] / 50), cards[j] / 10, sd[j] / 200, 1.0 if j == i else 0.0, ((j - r['turn']) % n) / n,
             r['deck'] / 40, r['mules'] / 4, r['pool'] / 2000, r['future'] / 1000, n == 3, n == 4, n == 5,
             money[j] / max(1.0, money.sum()), (herd[j] > 0).sum() / 10, max(0.0, money[j] - max(money[others])) / 500, min(money[j], 2000) / 2000]])
        X[slot] = row; mask[slot] = 1
    return X, mask, order

def load(path):
    Xs, Ms, Ws, Os, Bs, G = [], [], [], [], [], []
    with open(path) as f:
        for line in f:
            r = json.loads(line); n = r['n']
            for i in range(n):
                if r['views'][i] is None: continue
                X, m, order = feats(r, i)
                w = np.zeros(NP, dtype=np.float32); b = np.zeros(NP, dtype=np.float32); own = np.full(NT, -1, dtype=np.int64)
                for slot, j in enumerate(order): w[slot] = r['wins'][j]; b[slot] = r['views'][i]['base'][j]
                for k in range(NT):
                    if r['owner'][k] >= 0: own[k] = order.index(r['owner'][k])
                Xs.append(X); Ms.append(m); Ws.append(w); Os.append(own); Bs.append(b); G.append(r['gid'])
    return [torch.tensor(np.array(a)) for a in (Xs, Ms, Ws, Os, Bs)] + [np.array(G)]

class Net(nn.Module):
    def __init__(s, d=57, h=96, e=64):
        super().__init__()
        s.enc = nn.Sequential(nn.Linear(d, h), nn.SiLU(), nn.Linear(h, e), nn.SiLU())
        s.mix = nn.Sequential(nn.Linear(2 * e, e), nn.SiLU())
        s.win = nn.Linear(e, 1); s.own = nn.Linear(e, NT)
    def forward(s, X, M):
        h = s.enc(X)                                    # B x P x e
        c = (h * M[..., None]).sum(1, keepdim=True) / M.sum(1, keepdim=True)[..., None]
        z = s.mix(torch.cat([h, c.expand_as(h)], -1))
        neg = (1 - M) * -1e9
        return s.win(z).squeeze(-1) + neg, s.own(z) + neg[..., None]

def losses(net, X, M, W, O):
    zw, zo = net(X, M)
    lw = -(W * F.log_softmax(zw, 1)).sum(1).mean()
    lo = F.cross_entropy(zo.permute(0, 2, 1).reshape(-1, NP), O.reshape(-1), ignore_index=-1)
    return lw, lo

# parity check data for the JavaScript version (agent/scripts/net.mjs): a few positions with the network's win chances
def parity(net, path, rows=20):
    out = []
    with open(path) as f:
        for li, line in enumerate(f):
            if li >= rows: break
            r = json.loads(line); i = r['turn']
            X, m, order = feats(r, i)
            with torch.no_grad(): zw, _ = net(torch.tensor(X)[None].to(dev), torch.tensor(m)[None].to(dev))
            p = torch.softmax(zw[0], 0).cpu().numpy()
            out.append({'row': r, 'me': i, 'p': {int(j): float(p[slot]) for slot, j in enumerate(order)}})
    return out

if __name__ == '__main__':
    cache = path + '.npz'
    if os.path.exists(cache): z = np.load(cache); X, M, W, O, B = [torch.tensor(z[k]) for k in 'XMWOB']; G = z['G']
    else:
        X, M, W, O, B, G = load(path); np.savez(cache, X=X.numpy(), M=M.numpy(), W=W.numpy(), O=O.numpy(), B=B.numpy(), G=G)
    print('positions', len(X), 'games', len(set(G.tolist())))
    games = sorted(set(G.tolist())); random.Random(1).shuffle(games); test = set(games[:max(1, len(games) // 8)])
    te = torch.tensor([g in test for g in G]); tr = ~te
    base = -(W[te] * torch.log(B[te].clamp_min(1e-6) + (1 - M[te]))).sum(1).mean().item()
    print('base model test log loss', round(base, 4), 'uniform', round((-(W[te] * torch.log(M[te] / M[te].sum(1, keepdim=True) + (1 - M[te]))).sum(1)).mean().item(), 4))
    net = Net(h=int(os.environ.get('H', 64)), e=int(os.environ.get('E', 32))).to(dev); opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=float(os.environ.get('WD', 3e-3)))
    Xt, Mt, Wt, Ot = [a[tr].to(dev) for a in (X, M, W, O)]; Xe, Me, We, Oe = [a[te].to(dev) for a in (X, M, W, O)]
    bs = 2048; steps = epochs * (len(Xt) // bs + 1); sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps)
    best = None
    for ep in range(epochs):
        net.train(); perm = torch.randperm(len(Xt), device=dev)
        for s0 in range(0, len(Xt), bs):
            idx = perm[s0:s0 + bs]; lw, lo = losses(net, Xt[idx], Mt[idx], Wt[idx], Ot[idx])
            opt.zero_grad(); (lw + 0.3 * lo).backward(); opt.step(); sched.step()
        net.eval()
        with torch.no_grad(): lw, lo = losses(net, Xe, Me, We, Oe)
        print(f'epoch {ep} test win loss {lw.item():.4f} set loss {lo.item():.4f}', flush=True)
        if best is None or lw.item() < best[0]: best = (lw.item(), copy.deepcopy(net.state_dict()))
    net.load_state_dict(best[1]); print('best test win loss', round(best[0], 4))
    sd = {k: v.detach().cpu().numpy().round(6).tolist() for k, v in net.state_dict().items()}
    json.dump(sd, open(out, 'w'))
    json.dump(parity(net, path), open(out + '.parity.json', 'w'))
    print('saved', out)
