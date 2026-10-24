# A learned position value for Koehandel: from what everyone holds at the start of a turn, each player's chance to
# win. Data from agent/cpp/datagen.exe (rows of float32, see there). The network has the structure of the hand-made
# model in lib/bots/brain.js, learned instead of fixed: for every player and animal type a small shared network
# reads that player's position in that type (its copies, the most and second most any other player holds, the copies
# still in the deck, the type's value, its money against the others'), the results are summed over the types, and a
# second network turns that and the money into a score; the win chances are a softmax of the scores over the players.
#   python agent/value/train.py <data.bin> [more.bin ...]   (env PLAYERS=3 EPOCHS=30 OUT=agent/value/net.json WIDTHS=32,32,64)
import json, os, sys, time
import numpy as np
import torch
import torch.nn as nn

NT = 10
VAL = np.array([1000, 800, 650, 500, 350, 250, 160, 90, 40, 10], dtype=np.float32)
N = int(os.environ.get('PLAYERS', 3))
# ARCH=b: the per-type network does not see money (money only enters the player network), so a decision that moves
# money re-evaluates just the player network, and one that moves an animal just that type's networks.
# ARCH=c: as b, plus per type the player's own money and the money of the other players holding the most and second
# most copies (who wins a split type in a koehandel depends on the money of the one holding the other copies)
ARCH = os.environ.get('ARCH', 'a')
# STYLE=1: rows also hold every player's style of play so far (datagen STYLE=1), which the player network then reads
STYLE = int(os.environ.get('STYLE', 0))
ROW = 4 + 2 * NT + N * (NT + 3) + 3 * N + 1 + (2 * N if STYLE else 0)


def load(files):
    xs = [np.fromfile(f, dtype=np.float32) for f in files]
    a = np.concatenate([x[:len(x) // ROW * ROW].reshape(-1, ROW) for x in xs])  # (a run cut short may end mid-row)
    return a


def features(a):
    """Per row: type features [rows, N, NT, FT], player features [rows, N, FP], alive mask [rows, N], targets."""
    R = len(a)
    deckSize, deckLeft, mules, turn = a[:, 0], a[:, 1], a[:, 2], a[:, 3].astype(int)
    left, counts = a[:, 4:4 + NT], a[:, 4 + NT:4 + 2 * NT]
    P = a[:, 4 + 2 * NT:4 + 2 * NT + N * (NT + 3)].reshape(R, N, NT + 3)
    herd, money, ncards, out = P[:, :, :NT], P[:, :, NT], P[:, :, NT + 1], P[:, :, NT + 2]
    o = 4 + 2 * NT + N * (NT + 3)
    wins, scores, who, seed = a[:, o:o + N], a[:, o + N:o + 2 * N], a[:, o + 2 * N:o + 3 * N], a[:, o + 3 * N]
    alive = 1 - out
    c = np.maximum(counts, 1)[:, None, :]                         # copies of each type in this deck
    h = herd / c                                                  # [R, N, NT]
    # the most and second most copies any other player holds
    oth = np.stack([np.delete(herd, j, axis=1) for j in range(N)], axis=1)  # [R, N, N-1, NT]
    oth = np.sort(oth, axis=2)[:, :, ::-1, :]
    m1 = oth[:, :, 0, :] / c
    m2 = (oth[:, :, 1, :] if N > 2 else np.zeros_like(oth[:, :, 0, :])) / c
    mon = money / 1000.0
    omon = np.stack([np.delete(mon, j, axis=1) for j in range(N)], axis=1)  # [R, N, N-1]
    omon = np.sort(omon, axis=2)[:, :, ::-1]
    lf = np.broadcast_to((left / np.maximum(counts, 1))[:, None, :], h.shape)
    val = np.broadcast_to((VAL / 1000.0)[None, None, :], h.shape)
    present = np.broadcast_to((counts > 0)[:, None, :], h.shape).astype(np.float32)
    dl = (deckLeft / np.maximum(deckSize, 1))[:, None]
    dlt = np.broadcast_to(np.broadcast_to(dl, mon.shape)[:, :, None], h.shape)
    if ARCH == 'b': ft = np.stack([h, m1, m2, lf, val, present, dlt], axis=-1).astype(np.float32)
    elif ARCH == 'c':
        omn = np.stack([np.delete(mon, j, axis=1) for j in range(N)], axis=1)        # [R, N, N-1], others' money
        oh = np.stack([np.delete(herd, j, axis=1) for j in range(N)], axis=1)       # [R, N, N-1, NT], their copies
        key = oh * 1e4 + omn[:, :, :, None]                                         # most copies, then richest
        order = np.argsort(-key, axis=2, kind='stable')
        om = np.broadcast_to(omn[:, :, :, None], key.shape)
        r1 = np.take_along_axis(om, order[:, :, 0:1, :], axis=2)[:, :, 0, :]
        r2 = np.take_along_axis(om, order[:, :, 1:2, :], axis=2)[:, :, 0, :] if N > 2 else np.zeros_like(m1)
        r1 = np.where(m1 > 0, r1, 0); r2 = np.where(m2 > 0, r2, 0)
        own = np.broadcast_to(mon[:, :, None], h.shape)
        ft = np.stack([h, m1, m2, lf, val, present, dlt, own, r1, r2], axis=-1).astype(np.float32)
    else: ft = np.stack([h, m1, m2, lf, val, present, np.broadcast_to(mon[:, :, None], h.shape),
                         np.broadcast_to(omon[:, :, 0:1], h.shape), dlt], axis=-1).astype(np.float32)
    isTurn = (np.arange(N)[None, :] == turn[:, None]).astype(np.float32)
    fp = np.concatenate([mon[:, :, None], omon, (ncards / 20.0)[:, :, None], np.broadcast_to(dl, mon.shape)[:, :, None],
                         np.broadcast_to((mules / 4.0)[:, None], mon.shape)[:, :, None], isTurn[:, :, None],
                         np.broadcast_to((deckSize / 40.0)[:, None], mon.shape)[:, :, None]], axis=-1).astype(np.float32)
    if STYLE:  # own keenness (log) and buy-back rate, then the others' in the order of their money (largest first)
        st = a[:, o + 3 * N + 1:o + 5 * N + 1].reshape(R, N, 2).copy(); st[:, :, 0] = np.log(st[:, :, 0])
        rest = []
        for j in range(N):
            others = [x for x in range(N) if x != j]
            order = np.argsort(-mon[:, others], axis=1, kind='stable')
            rest.append(np.concatenate([st[:, j]] + [st[np.arange(R), np.array(others)[order[:, x]]] for x in range(N - 1)], axis=1))
        fp = np.concatenate([fp, np.stack(rest, axis=1)], axis=-1).astype(np.float32)
    return ft, fp, alive.astype(np.float32), wins.astype(np.float32), seed, who


class Net(nn.Module):
    def __init__(s, ft, fp, H=32, E=32, H2=64):
        super().__init__()
        s.t = nn.Sequential(nn.Linear(ft, H), nn.ReLU(), nn.Linear(H, E), nn.ReLU())
        s.p = nn.Sequential(nn.Linear(E + fp, H2), nn.ReLU(), nn.Linear(H2, H2), nn.ReLU(), nn.Linear(H2, 1))

    def forward(s, ft, fp, alive):
        e = s.t(ft).sum(dim=2)                                    # [B, N, E]
        z = s.p(torch.cat([e, fp], dim=-1)).squeeze(-1)           # [B, N]
        return z.masked_fill(alive < 0.5, -1e9)


def main():
    files = sys.argv[1:]
    a = load(files)
    seed = a[:, 4 + 2 * NT + N * (NT + 3) + 3 * N]
    games = np.unique(seed)
    rng = np.random.default_rng(1)
    vm = np.isin(seed, rng.choice(games, size=max(1, len(games) // 10), replace=False))
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    # the inputs are built a chunk of rows at a time and kept on the device (HALF=1: at half precision, for big data)
    half = torch.float16 if int(os.environ.get('HALF', 0)) else torch.float32
    parts = {False: [[], [], [], []], True: [[], [], [], []]}
    for i in range(0, len(a), 400000):
        ft, fp, alive, wins, _, _ = features(a[i:i + 400000]); m = vm[i:i + 400000]
        for v, sel in ((False, ~m), (True, m)):
            for x, xs, dt in zip((ft, fp, alive, wins), parts[v], (half, half, torch.float32, torch.float32)):
                xs.append(torch.tensor(np.ascontiguousarray(x[sel]), device=dev).to(dt))
        del ft, fp, alive, wins
    tr = [torch.cat(x) for x in parts[False]]; va = [torch.cat(x) for x in parts[True]]; del parts
    nft, nfp = tr[0].shape[-1], tr[1].shape[-1]
    print(f'{len(a)} rows, {len(games)} games, {vm.sum()} validation rows, on {dev}')
    W = [int(x) for x in os.environ.get('WIDTHS', '32,32,64').split(',')]  # H, E, H2
    net = Net(nft, nfp, *W).to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-5)
    EPOCHS = int(os.environ.get('EPOCHS', 30)); B = 1024
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    def loss_of(z, w):
        return -(w * torch.log_softmax(z, dim=-1)).sum(-1).mean()
    for ep in range(EPOCHS):
        t0 = time.time(); net.train(); perm = torch.randperm(len(tr[0]), device=dev); tot = 0
        for i in range(0, len(perm), B):
            idx = perm[i:i + B]
            l = loss_of(net(tr[0][idx].float(), tr[1][idx].float(), tr[2][idx]), tr[3][idx])
            opt.zero_grad(); l.backward(); opt.step(); tot += l.item() * len(idx)
        sched.step(); net.eval()
        with torch.no_grad():
            vl = sum(loss_of(net(va[0][i:i + 8192].float(), va[1][i:i + 8192].float(), va[2][i:i + 8192]), va[3][i:i + 8192]).item() * len(va[0][i:i + 8192])
                     for i in range(0, len(va[0]), 8192)) / len(va[0])
        print(f'epoch {ep}: train {tot / len(perm):.4f} validation {vl:.4f} ({time.time() - t0:.1f}s)', flush=True)
    out = os.environ.get('OUT', 'agent/value/net.json')
    sd = {k: v.detach().cpu().numpy().tolist() for k, v in net.state_dict().items()}
    sizes = np.unique(a[:, 0]).astype(int)  # the deck size it is for (0: several)
    json.dump({'players': N, 'size': int(sizes[0]) if len(sizes) == 1 else 0, 'arch': ARCH, 'style': STYLE, 'ft': nft, 'fp': nfp, 'weights': sd}, open(out, 'w'))
    with torch.no_grad():
        z = torch.cat([net(va[0][i:i + 8192].float(), va[1][i:i + 8192].float(), va[2][i:i + 8192]) for i in range(0, len(va[0]), 8192)])
        ll = -(va[3] * torch.log_softmax(z, -1)).sum(-1).cpu().numpy()
    dl = (a[vm, 1] / np.maximum(a[vm, 0], 1))
    for lo, hi in [(0.75, 1.01), (0.5, 0.75), (0.25, 0.5), (0, 0.25)]:
        sel = (dl >= lo) & (dl < hi); print(f'  deck {lo:.2f}-{hi:.2f}: {ll[sel].mean():.4f} ({sel.sum()} rows)')
    print('saved', out)


if __name__ == '__main__':
    main()
