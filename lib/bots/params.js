// Brain parameters per level, from the tuning runs in agent/ (see agent/README.md).
// hard: tuned by self-play with sep-CMA-ES (stage C). medium: the same judgement played less precisely (its noise and
// slips are set in index.js). easy: naive habits (timid bids, little feeling for sets or money), calibrated to rate
// the same as a novice player.
export default {
  hard: {"rho": 1.289, "gamma": 1.106, "delta": 0.8568, "mu": 508.3, "tau": 1.432, "tau1": 68.93, "eps": 0.02007, "mBid": -0.02469, "shade": 1.149, "mDec": 0.02409, "aucM": 0.8172, "khBias": -0.009984, "pc": 1, "gap": 11.54, "pad": 0.4521, "phi": 0.9213, "mResp": -0.5469},
  medium: {"rho": 1.289, "gamma": 1.106, "delta": 0.8568, "mu": 508.3, "tau": 1.432, "tau1": 68.93, "eps": 0.02007, "mBid": -0.02469, "shade": 1.149, "mDec": 0.02409, "aucM": 0.8172, "khBias": -0.009984, "pc": 1, "gap": 11.54, "pad": 0.4521, "phi": 0.9213, "mResp": -0.5469},
  easy: { shade: 0.9, mBid: 0.1, gamma: 1, delta: 0.25 },
};
