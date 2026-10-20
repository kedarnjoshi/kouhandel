"""Charts and ratings for agent/README.md.

python agent/scripts/analyze.py            -> agent/img/*.svg and agent/runs/summary.json
Reads agent/runs/stage*.jsonl (tuning curves), agent/runs/ladder*.json (mixed-table tournaments) and
agent/runs/think.json (thinking-time samples) when present.
"""
import glob
import json
import math
import os
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
RUNS, IMG = os.path.join(ROOT, "runs"), os.path.join(ROOT, "img")
os.makedirs(IMG, exist_ok=True)
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "svg.fonttype": "none"})
COLORS = {"random": "#9e9e9e", "confusing": "#c792ea", "novice": "#f2cc8f", "easy": "#81b29a", "medium": "#7aa5d8",
          "hard": "#e07a5f", "insane": "#b5332e"}
summary = {}


def color(level):
    return COLORS.get(level.split(":")[0], "#555")


def save(fig, name):
    fig.tight_layout()
    fig.savefig(os.path.join(IMG, name), format="svg")
    plt.close(fig)


# ---- tuning curves -------------------------------------------------------------------------------------------
stages = sorted(glob.glob(os.path.join(RUNS, "stage*.jsonl")))
if stages:
    fig, ax = plt.subplots(figsize=(7, 3.6))
    for path in stages:
        rows = [json.loads(line) for line in open(path) if line.strip()]
        name = os.path.basename(path)[:-6]
        ax.plot([r["gen"] for r in rows], [r["avg"] for r in rows], label=f"{name} (population average)")
    ax.axhline(1, color="#999", lw=1, ls="--")
    ax.set_xlabel("generation")
    ax.set_ylabel("win share x players\n(1 = as good as the field)")
    ax.set_title("Tuning: each stage plays against the winner of the stage before")
    ax.legend(frameon=False, fontsize=8)
    save(fig, "tuning.svg")


# ---- ratings from mixed tables ---------------------------------------------------------------------------------
def ratings(games):
    """Bradley-Terry ratings (Elo scale) from every pair of seats in every game: higher score wins the pair."""
    wins, n = defaultdict(float), defaultdict(float)
    levels = sorted({s for g in games for s in g["seats"]})
    for g in games:
        sc, st = g["scores"], g["seats"]
        for i in range(len(st)):
            for j in range(len(st)):
                if i < j and st[i] != st[j]:
                    a, b = st[i], st[j]
                    w = 1.0 if sc[i] > sc[j] else 0.0 if sc[i] < sc[j] else 0.5
                    wins[(a, b)] += w
                    wins[(b, a)] += 1 - w
                    n[(a, b)] += 1
                    n[(b, a)] += 1
    p = {lv: 1.0 for lv in levels}
    for _ in range(500):  # minorisation-maximisation (Hunter 2004)
        new = {}
        for a in levels:
            num = sum(wins[(a, b)] for b in levels if b != a) + 0.5
            den = sum(n[(a, b)] / (p[a] + p[b]) for b in levels if b != a and n[(a, b)]) + 1 / (p[a] + 1)
            new[a] = num / den
        g = math.exp(sum(math.log(v) for v in new.values()) / len(new))
        p = {k: v / g for k, v in new.items()}
    elo = {k: 400 * math.log10(v) for k, v in p.items()}
    base = elo.get("random", min(elo.values()))
    pair = {f"{a} vs {b}": round(wins[(a, b)] / n[(a, b)], 3) for a in levels for b in levels if a != b and n[(a, b)]}
    return {k: round(v - base) for k, v in elo.items()}, pair, levels, wins, n


for path in sorted(glob.glob(os.path.join(RUNS, "ladder*.json"))):
    name = os.path.basename(path)[:-5]
    games = json.load(open(path))
    elo, pair, levels, wins, n = ratings(games)
    order = sorted(levels, key=lambda k: elo[k])
    summary[name] = {"games": len(games), "elo": elo, "pairwise": pair,
                     "unfinished": sum(1 for g in games if not g.get("done", True))}
    fig, ax = plt.subplots(figsize=(7, 3.4))
    ax.barh(order, [elo[k] for k in order], color=[color(k) for k in order])
    for y, k in enumerate(order):
        ax.text(elo[k] + 15, y, str(elo[k]), va="center", fontsize=9)
    ax.set_xlabel("rating (Elo scale, random = 0)")
    ax.set_title(f"{name}: {len(games)} games of 3-5 players")
    save(fig, f"{name}-elo.svg")
    fig, ax = plt.subplots(figsize=(5.6, 4.6))
    m = [[wins[(a, b)] / n[(a, b)] if n[(a, b)] else float("nan") for b in order] for a in order]
    im = ax.imshow(m, cmap="RdYlGn", vmin=0, vmax=1)
    ax.set_xticks(range(len(order)), order, rotation=45, ha="right")
    ax.set_yticks(range(len(order)), order)
    for i in range(len(order)):
        for j in range(len(order)):
            if not math.isnan(m[i][j]):
                ax.text(j, i, f"{m[i][j]:.0%}", ha="center", va="center", fontsize=8)
    ax.set_title("row beats column (share of head-to-head\nfinishes at the same table)", fontsize=9)
    fig.colorbar(im, fraction=0.04)
    save(fig, f"{name}-matrix.svg")

# ---- thinking time -------------------------------------------------------------------------------------------
tp = os.path.join(RUNS, "think.json")
if os.path.exists(tp):
    think = json.load(open(tp))
    fig, ax = plt.subplots(figsize=(7, 3.4))
    names = list(think)
    ax.boxplot([[x / 1000 for x in think[k]] for k in names], vert=False, showfliers=False, whis=(5, 95))
    ax.set_yticks(range(1, len(names) + 1), names)
    ax.set_xlabel("seconds (time per move: 30s, boxes 25-75%, whiskers 5-95%)")
    ax.set_title("How long the bots think before a decision")
    save(fig, "think.svg")

# ---- extra series written by experiments -------------------------------------------------------------------
for path in glob.glob(os.path.join(RUNS, "series-*.json")):
    d = json.load(open(path))
    fig, ax = plt.subplots(figsize=(6, 3.2))
    for label, pts in d["series"].items():
        ax.errorbar([p[0] for p in pts], [p[1] for p in pts], yerr=[p[2] for p in pts], marker="o", capsize=3, label=label)
    if "fair" in d:
        ax.axhline(d["fair"], color="#999", lw=1, ls="--")
    ax.set_xlabel(d["x"])
    ax.set_ylabel(d["y"])
    ax.set_title(d["title"])
    if len(d["series"]) > 1:
        ax.legend(frameon=False, fontsize=8)
    if d.get("logx"):
        ax.set_xscale("log")
    save(fig, os.path.basename(path)[7:-5] + ".svg")
    summary[os.path.basename(path)[:-5]] = d["series"]

json.dump(summary, open(os.path.join(RUNS, "summary.json"), "w"), indent=1)
print(json.dumps({k: (v.get("elo") if isinstance(v, dict) and "elo" in v else "...") for k, v in summary.items()}, indent=1))
