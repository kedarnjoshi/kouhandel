// lib/bots/tracker.js: guesses of everyone's money cards, replayed through the public history.
#pragma once
#include <map>
#include "brain.h"

namespace kh {
// TRACKER in tracker.js (read from agent/cpp/levels.json by the registry; these are the defaults)
struct TrackerSettings { int K = 400; double TILT = 1.5, FLOOR = 0.05, BOLD = 0, BOLDH = 0, BOLDN = 2, BOLDAT = 0.6; bool choices = false, sums = false; };
inline TrackerSettings& TRACKER() { static TrackerSettings t; return t; }
using Hand = vector<int>;
struct TrackState { size_t len = 0; Rng rand; vector<double> w; vector<vector<Hand>> P; bool lost = false; double seen[MAXP] = {0}, bold[MAXP] = {0}; bool person[MAXP] = {false}; };
struct TrackRes {
  double mean[MAXP] = {0}, sd[MAXP] = {0}, W = 0; int K = 0; std::shared_ptr<TrackState> st;
  // count hands of player j drawn from the guesses (by weight), each { hand, w }
  void hands(int j, int count, Rng& rand, vector<std::pair<Hand, double>>& out) const {
    out.clear();
    for (int c = 0; c < count; c++) { double r = rand() * W; int k = 0; for (; k < K - 1; k++) { r -= st->w[k]; if (r <= 0) break; } out.push_back({st->P[k][j], 1.0 / count}); }
  }
};
inline int ttotal(const Hand& h) { int t = 0; for (int c : h) t += c; return t; }
inline bool ttake(Hand& h, const vector<int>& cards) {
  bool ok = true;
  for (int c : cards) {
    int x = -1; for (size_t y = 0; y < h.size(); y++) if (h[y] == c) { x = (int)y; break; }
    if (x < 0) { ok = false; double bd = INF; for (size_t y = 0; y < h.size(); y++) { double d = std::abs(h[y] - c); if (d < bd) { bd = d; x = (int)y; } } }
    if (x >= 0) h.erase(h.begin() + x);
  }
  return ok;
}
// Every distinct way to take m cards from a hand: (cards, number of card choices that give them).
inline vector<std::pair<Hand, double>> subsets(const Hand& h, int m) {
  Hand s = h; std::stable_sort(s.begin(), s.end(), [](int x, int y) { return x - y < 0; });
  vector<int> vals, cnt;
  for (int c : s) { if (vals.size() && vals.back() == c) cnt.back()++; else { vals.push_back(c); cnt.push_back(1); } }
  vector<std::pair<Hand, double>> out; Hand cur;
  auto choose = [](double n, int r) { double x = 1; for (int t = 0; t < r; t++) x = x * (n - t) / (t + 1); return x; };
  std::function<void(size_t, int, double)> rec = [&](size_t v, int left, double mult) {
    if (v == vals.size()) { if (!left) out.push_back({cur, mult}); return; }
    for (int t = 0; t <= std::min(cnt[v], left); t++) { for (int u = 0; u < t; u++) cur.push_back(vals[v]); rec(v + 1, left - t, mult * choose(cnt[v], t)); cur.resize(cur.size() - t); }
  };
  rec(0, m, 1);
  return out;
}
inline Hand payWith(const Hand& h, int m, int p) {
  if (m >= (int)h.size()) return h;
  Hand s = h; std::sort(s.begin(), s.end());
  bool found = false; int bestSum = 0; Hand bestCards, cur;
  std::function<void(int, int, int)> rec = [&](int start, int left, int acc) {
    if (!left) { if (acc >= p && (!found || acc < bestSum)) { found = true; bestSum = acc; bestCards = cur; } return; }
    for (int x = start; x <= (int)s.size() - left; x++) {
      if (x > start && s[x] == s[x - 1]) continue;
      cur.push_back(s[x]); rec(x + 1, left - 1, acc + s[x]); cur.pop_back();
      if (found && bestSum == p) return;
    }
  };
  if (m <= 6 && s.size() <= 22) rec(0, m, 0);
  if (!found) { Hand d(s.rbegin(), s.rend()); d.resize(m); return d; }
  return bestCards;
}
inline void tresample(TrackState& st) {
  const int K = (int)st.w.size();
  double W = 0, W2 = 0; for (int k = 0; k < K; k++) { W += st.w[k]; W2 += st.w[k] * st.w[k]; }
  if (!(W > 0)) return;
  if (W * W / W2 > K / 2.0) return;
  vector<vector<Hand>> out; out.reserve(K);
  double u0 = st.rand() / K, acc = st.w[0] / W; int k = 0;
  for (int c = 0; c < K; c++) { double u = u0 + (double)c / K; while (u > acc && k < K - 1) { k++; acc += st.w[k] / W; } out.push_back(st.P[k]); }
  st.P = std::move(out); for (int x = 0; x < K; x++) st.w[x] = 1;
}
// subsets grouped by total, ascending (bySum in tracker.js)
struct SumGroup { int s; vector<std::pair<Hand, double>> sets; double W = 0, Q = 0; };
inline vector<SumGroup> bySum(const Hand& h, int m) {
  std::map<int, SumGroup> g;
  for (auto& [x, c] : subsets(h, m)) {
    int s = ttotal(x); double u = TRACKER().choices ? c : 1;
    auto it = g.find(s); if (it == g.end()) { it = g.emplace(s, SumGroup()).first; it->second.s = s; }
    it->second.sets.push_back({x, u}); it->second.W += u;
  }
  vector<SumGroup> out; for (auto& [k, e] : g) out.push_back(std::move(e));
  for (auto& e : out) e.Q = TRACKER().sums ? 1 : e.W; // the group's weight as an offer
  return out;
}
inline const Hand& pickSet(const SumGroup& e, Rng& rand) { double r = rand() * e.W; for (auto& [x, u] : e.sets) { r -= u; if (r <= 0) return x; } return e.sets.back().first; }
// kWays in tracker.js
struct Ways { vector<SumGroup> A, B; bool hasB = false; vector<double> ea, eb, gw; vector<int> lo, hi; double fit = 0, all = 0; bool any = false; int last = 0; };
// offerW in tracker.js
inline double offerW(const vector<SumGroup>& sets, int s, double scale, double bold) {
  const TrackerSettings& T = TRACKER();
  return (1 - bold) * mexp(-T.TILT * s / scale) + bold * mexp(-T.TILT * (sets.back().s - s) / scale);
}
inline Ways kWays(const Hand& ha, const Hand& hb, int na, int nb, bool aWon, double ba, double bb) {
  const TrackerSettings& T = TRACKER(); Ways w;
  const int la = std::min(na, (int)ha.size()); const double avgA = (double)ttotal(ha) / std::max(1, (int)ha.size());
  w.A = bySum(ha, la); const int nA = (int)w.A.size();
  for (auto& e : w.A) w.ea.push_back(offerW(w.A, e.s, avgA * la + 10, ba));
  w.gw.assign(nA, 0); w.lo.assign(nA, 0); w.hi.assign(nA, 0);
  double WA = 0; for (auto& e : w.A) WA += e.Q;
  if (nb < 0) {
    for (int x = 0; x < nA; x++) { w.gw[x] = w.A[x].Q * (T.FLOOR + w.ea[x]); w.fit += w.gw[x]; w.last = x; }
    w.all = WA; w.any = nA > 0; return w;
  }
  w.hasB = true;
  const int lb = std::min(nb, (int)hb.size()); const double avgB = (double)ttotal(hb) / std::max(1, (int)hb.size());
  w.B = bySum(hb, lb); const int nB = (int)w.B.size();
  for (auto& e : w.B) w.eb.push_back(offerW(w.B, e.s, avgB * lb + 10, bb));
  vector<double> PW{0}, PE{0};
  for (int y = 0; y < nB; y++) { PW.push_back(PW[y] + w.B[y].Q); PE.push_back(PE[y] + w.B[y].Q * w.eb[y]); }
  int c = 0;
  for (int x = 0; x < nA; x++) {
    while (c < nB && w.B[c].s <= w.A[x].s) c++;
    w.lo[x] = aWon ? 0 : c; w.hi[x] = aWon ? c : nB;
    const double fw = PW[w.hi[x]] - PW[w.lo[x]], fe = PE[w.hi[x]] - PE[w.lo[x]];
    w.gw[x] = w.A[x].Q * (T.FLOOR * fw + w.ea[x] * fe); w.fit += w.gw[x];
    if (fw > 0) w.any = true, w.last = x;
  }
  w.all = WA * PW[nB];
  return w;
}
inline void tstep(TrackState& st, const HistE& e, int i, int n) {
  auto& P = st.P; vector<double>& w = st.w; Rng& rand = st.rand; const int K = (int)P.size(); const TrackerSettings& T = TRACKER();
  if (e.t == 'm') { for (int j : e.to) if (j != i) for (auto& h : P) h[j].push_back(e.amt); return; }
  if (e.t == 'a') {
    for (int j = 0; j < MAXP; j++) { if (!e.mx[j] || j == i) continue; for (int k = 0; k < K; k++) if (ttotal(P[k][j]) < e.mx[j]) w[k] *= 0.02; }
    if (!e.hasCards) return;
    int payer = e.P, payee = e.Q, m = e.m, p = e.p;
    for (int k = 0; k < K; k++) {
      auto& h = P[k];
      if (payer == i) { if (payee != i) h[payee].insert(h[payee].end(), e.cs.begin(), e.cs.end()); }
      else if (payee == i) { if (!ttake(h[payer], e.cs)) w[k] *= 0.02; }
      else { Hand cs = payWith(h[payer], m, p); if (ttotal(cs) < p) w[k] *= 0.02; ttake(h[payer], cs); h[payee].insert(h[payee].end(), cs.begin(), cs.end()); }
    }
    tresample(st);
    return;
  }
  if (e.t == 'k') {
    int a = e.a, b = e.b, na = e.na, nb = e.nb, win = e.win; bool hasNb = nb >= 0;
    bool tie = hasNb && e.x == e.y; // (the amounts are only seen in own deals, the only place tie is used)
    bool mineDeal = a == i || b == i; int kept = 0;
    if (mineDeal) { // an offer I saw: was it bold? (tracker.js)
      int j = a == i ? b : a; bool has = a == i ? hasNb : true; double x = a == i ? e.y : e.x;
      if (has) { double m = 0, W = 0; for (int k = 0; k < K; k++) { m += w[k] * ttotal(P[k][j]); W += w[k]; } st.seen[j]++; if (x >= T.BOLDAT * jmax(10, m / W)) st.bold[j]++; }
    }
    auto boldness = [&](int j) { return ((st.person[j] ? T.BOLDH : T.BOLD) * T.BOLDN + st.bold[j]) / (T.BOLDN + st.seen[j]); };
    std::map<std::pair<Hand, Hand>, Ways> memo; // (a pure cache, as in tracker.js)
    for (int k = 0; k < K; k++) {
      auto& h = P[k];
      if (mineDeal) {
        int other = a == i ? b : a; const Hand& theirs = a == i ? e.cb : e.ca; const Hand& mine = a == i ? e.ca : e.cb;
        if (!hasNb) { if (a == i) { h[b].insert(h[b].end(), e.ca.begin(), e.ca.end()); kept++; } else if (!ttake(h[a], e.ca)) w[k] *= 0.02; else kept++; continue; }
        if (tie) { kept++; continue; }
        if (!ttake(h[other], theirs)) w[k] *= 0.02; else kept++;
        h[other].insert(h[other].end(), mine.begin(), mine.end());
        continue;
      }
      // someone else's deal: the distinct sets each side could have put down, grouped by total (see tracker.js)
      auto key = std::make_pair(h[a], h[b]);
      auto it = memo.find(key);
      if (it == memo.end()) it = memo.emplace(key, kWays(h[a], h[b], na, hasNb ? nb : -1, win == a, boldness(a), hasNb ? boldness(b) : 0)).first;
      const Ways& ways = it->second;
      if (!ways.any) { w[k] *= 0.01; continue; }
      w[k] *= jmax(0.03, ways.fit / ways.all);
      double r = rand() * ways.fit; int g = ways.last;
      for (int x = 0; x < (int)ways.A.size(); x++) { if (!(ways.gw[x] > 0)) continue; r -= ways.gw[x]; if (r <= 0) { g = x; break; } }
      int t = -1;
      if (ways.hasB) {
        const double ea = ways.ea[g]; double tw = 0;
        for (int y = ways.lo[g]; y < ways.hi[g]; y++) tw += ways.B[y].Q * (T.FLOOR + ea * ways.eb[y]);
        double r2 = rand() * tw; t = ways.hi[g] - 1;
        for (int y = ways.lo[g]; y < ways.hi[g]; y++) { r2 -= ways.B[y].Q * (T.FLOOR + ea * ways.eb[y]); if (r2 <= 0) { t = y; break; } }
      }
      Hand xa = pickSet(ways.A[g], rand);
      if (!ways.hasB) { ttake(h[a], xa); h[b].insert(h[b].end(), xa.begin(), xa.end()); }
      else { Hand xb = pickSet(ways.B[t], rand); if (ways.A[g].s != ways.B[t].s) { ttake(h[a], xa); ttake(h[b], xb); h[a].insert(h[a].end(), xb.begin(), xb.end()); h[b].insert(h[b].end(), xa.begin(), xa.end()); } }
    }
    if (mineDeal && !kept) st.lost = true; // every guess contradicts a deal I saw
    tresample(st);
  }
}
// Replays the history for viewer o.me (state kept with the game, per viewer). Null when tracking is not possible.
inline std::shared_ptr<TrackRes> track(Game& s, const Obs& o) {
  PROF("track");
  int i = o.me, n = o.n; const int K = TRACKER().K;
  if (s.histCut) return nullptr;
  auto& st = s.trk[i];
  if (!st || st->len > s.hist.size()) {
    st = std::make_shared<TrackState>();
    st->rand = Rng((uint32_t)(s.seed ^ (int32_t)(uint32_t)((uint64_t)i * 0x9e3779b1ull)));
    st->w.assign(K, 1); for (int j = 0; j < n; j++) st->person[j] = s.person[j];
    st->P.assign(K, vector<Hand>(n));
    for (int k = 0; k < K; k++) for (int j = 0; j < n; j++) if (j != i) st->P[k][j].assign(START_MONEY, START_MONEY + 7);
  }
  for (; st->len < s.hist.size(); st->len++) tstep(*st, s.hist[st->len], i, n);
  if (st->lost) return nullptr;
  double W = 0;
  for (int k = 0; k < K; k++) { for (int j = 0; j < n; j++) if (j != i && (int)st->P[k][j].size() != o.cards[j]) st->w[k] = 0; W += st->w[k]; }
  if (!(W > 0)) { st.reset(); return nullptr; }
  auto res = std::make_shared<TrackRes>(); res->W = W; res->st = st; res->K = K;
  for (int j = 0; j < n; j++) {
    if (j == i) continue;
    double m = 0, m2 = 0;
    for (int k = 0; k < K; k++) { double t = ttotal(st->P[k][j]), w = st->w[k] / W; m += w * t; m2 += w * t * t; }
    res->mean[j] = m; res->sd[j] = std::sqrt(jmax(0, m2 - m * m));
  }
  return res;
}
}  // namespace kh
