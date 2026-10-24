// lib/bots/expert.js: the second-generation bots (Easy to Insane), line by line.
#pragma once
#include <unordered_map>
#include "tracker.h"
#include "solver.h"

namespace kh {

// ---------------------------------------------------------------------------------------------------------------
// look(): observe plus the unseen cards, money estimates within what card counts allow, others' view of me.
inline void bidFloors(const Game& s, double* out) {
  bool stale[MAXP] = {false};
  for (int j = 0; j < MAXP; j++) out[j] = 0;
  for (int x = (int)s.hist.size() - 1; x >= 0; x--) {
    const HistE& e = s.hist[x];
    if (e.t == 'k') { stale[e.a] = stale[e.b] = true; continue; }
    if (e.t != 'a' || !e.hasLed) continue;
    for (int j = 0; j < MAXP; j++) if (e.mx[j] && !stale[j]) out[j] = jmax(out[j], e.mx[j] + s.ledger[j] - e.led[j]);
  }
}
const int OVERPAY[4] = {0, 1300, 50, 5};
inline double overDoubt(const Game& s, int v, int j) {
  double x = 0;
  for (const HistE& e : s.hist) if (e.t == 'a' && e.hasCards && e.m && (e.P == j || e.Q == j) && e.P != v && e.Q != v) x += OVERPAY[std::min(e.m, 3)];
  return x;
}
inline double futureIncome(const Obs& o) {
  double left = o.remain[MULE], f = 0;
  for (int k = 0; k < 4 - o.mules; k++) f += MULE_PAY[o.mules + k] * clampd(left - k, 0, 1);
  return f;
}
inline void look(Game& s, int i, const Th* th, Obs& o) { PROF("look");
  observe(s, i, o);
  const int n = s.n;
  vector<int>& unseen = o.unseen; unseen.clear();
  for (int j = 0; j < n; j++) if (j != i) unseen.insert(unseen.end(), s.P[j].money.begin(), s.P[j].money.end());
  std::stable_sort(unseen.begin(), unseen.end());
  vector<int> others; for (int x = 0; x < o.nact; x++) { int j = o.active[x]; if (j != i && o.cards[j]) others.push_back(j); }
  double tot = isum(unseen), avg = unseen.size() ? tot / unseen.size() : 0;
  double v2 = 0; for (int c : unseen) v2 += (c - avg) * (c - avg);
  double cardVar = unseen.size() ? v2 / unseen.size() : 0;
  vector<double> est, vr;
  for (int j : others) {
    double c = o.cards[j], vl = 25 + s.unc[i][j], vc = c * cardVar + 25;
    est.push_back((o.money[j] / vl + c * avg / vc) / (1 / vl + 1 / vc)); vr.push_back(1 / (1 / vl + 1 / vc));
  }
  double floors[MAXP]; bidFloors(s, floors);
  vector<double> LO, HI;
  for (int j : others) {
    double lo = 0, hi = 0; for (int y = 0; y < o.cards[j] && y < (int)unseen.size(); y++) { lo += unseen[y]; hi += unseen[unseen.size() - 1 - y]; }
    if (floors[j] > lo) lo = jmin(hi, floors[j]);
    LO.push_back(lo); HI.push_back(hi);
  }
  for (int j = 0; j < n; j++) if (j != i) o.money[j] = 0;
  size_t no = others.size();
  vector<double> cur(no);
  for (size_t x = 0; x < no; x++) cur[x] = clampd(est[x], LO[x], HI[x]);
  vector<char> fr(no);
  for (int pass = 0; pass < 4; pass++) {
    double sumc = 0; for (double c : cur) sumc += c;
    double gap = tot - sumc;
    for (size_t x = 0; x < no; x++) fr[x] = gap > 0 ? cur[x] < HI[x] : cur[x] > LO[x];
    double V = 0; for (size_t x = 0; x < no; x++) V = V + (fr[x] ? vr[x] : 0);
    if (std::fabs(gap) < 1 || !truthy(V)) break;
    for (size_t x = 0; x < no; x++) if (fr[x]) cur[x] = clampd(cur[x] + gap * vr[x] / V, LO[x], HI[x]);
  }
  for (size_t x = 0; x < no; x++) o.money[others[x]] = jround(cur[x]);
  for (int j = 0; j < n; j++) {
    o.sd[j] = j == i ? 0 : std::sqrt(25 + s.unc[i][j]);
    o.sdBy[j] = j == i ? 0 : std::sqrt(25 + s.unc[j][i]);
    o.sdS[j] = j == i ? 0 : std::sqrt(s.unc[i][j] + overDoubt(s, i, j));
    o.sdSBy[j] = j == i ? 0 : std::sqrt(s.unc[j][i] + overDoubt(s, j, i));
  }
  if (th && th->t(T_track)) {
    auto tr = track(s, o);
    if (tr) {
      o.track = tr; bool two = (*th)[T_track] == 2;
      for (int j : others) {
        double vl = o.sdS[j] * o.sdS[j] + 100, vt = tr->sd[j] * tr->sd[j] + 100;
        double m = two ? tr->mean[j] : (o.money[j] / vl + tr->mean[j] / vt) / (1 / vl + 1 / vt), v = two ? vt - 100 : 1 / (1 / vl + 1 / vt) - 100;
        o.money[j] = jround(m); o.sdS[j] = std::sqrt(jmax(0, v)); o.sd[j] = std::sqrt(jmax(25, v));
      }
    }
  }
  double pub = s.ledger[i];
  for (int j = 0; j < n; j++) o.seenAs[j] = j == i ? o.money[i] : jmax(0, pub - s.mem[i][j]);
  o.hasFuture = true; o.future = futureIncome(o);
}
// The same table from player j's side: j's money as I estimate it, mine as j estimates it.
inline Obs asSeenBy(const Obs& o, int j) {
  Obs r = o;
  if (j == o.me) return r;
  r.me = j;
  if (!o.hasHand) return r;
  r.money[o.me] = o.seenAs[j]; r.hasHand = false;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Auctions.
inline double plainLimit(const Obs& o, const Th& th, Model& M) { PROF("plainLimit");
  int me = o.me, k = o.ak, A = o.aA;
  int rivals[MAXP], nr = 0; for (int x = 0; x < o.nact; x++) { int j = o.active[x]; if (j != me && j != A) rivals[nr++] = j; }
  double mine = o.money[me];
  if (mine < 10) return 0;
  double W = 0, w[MAXP];
  for (int r = 0; r < nr; r++) { int j = rivals[r]; double x = (o.herd[j][k] + 0.3) * (o.money[j] + 10); W += x; w[r] = x; }
  auto win = [&](double p) { return M.util(me, {{me, k, 1}}, {{me, -p}, {A, p}}); };
  auto lose = [&](double p) {
    double u = 0; for (int r = 0; r < nr; r++) u += w[r] / W * M.util(me, {{rivals[r], k, 1}}, {{rivals[r], -p}, {A, p}});
    return nr ? u : M.util(me, {{A, k, 1}}, {});
  };
  double lo = 0, hi = tens(mine);
  if (win(hi) >= lose(hi)) lo = hi;
  else {
    if (win(0) < lose(0)) hi = 0;
    while (hi - lo > 10) { double mid = tens((lo + hi) / 2); if (win(mid) >= lose(mid)) lo = mid; else hi = mid; }
  }
  if (lo < 10 && win(10) > M.util(me, {{A, k, 1}}, {})) lo = 10;
  return lo;
}
inline const Th& PLAIN() { static const Th t = [] { Th x = DEFAULTS(); x.merge(EXPERT()); return x; }(); return t; }
inline void publicLimits(Game& s) {
  const Th& th = PLAIN(); Auction& a = s.au;
  int pred[MAXP]; bool has[MAXP] = {false};
  try {
    for (int j = 0; j < s.n; j++) {
      if (s.P[j].out || j == a.auctioneer) continue;
      Obs o; observe(s, j, o);
      for (int x = 0; x < s.n; x++) o.money[x] = s.P[x].out ? 0 : jmax(0, jround(s.ledger[x]));
      o.hasHand = false;
      Model M(o, th);
      pred[j] = (int)plainLimit(o, th, M); has[j] = true;
    }
  } catch (JsThrow&) { for (int j = 0; j < MAXP; j++) has[j] = false; }
  for (int j = 0; j < MAXP; j++) { a.hasPred[j] = has[j]; a.pred[j] = has[j] ? pred[j] : 0; }
}
inline double hurdle(const Obs& o, const Th& th, double q) {
  return th.z(T_mDec) * (th.t(T_mDecP) ? 1 - th[T_mDecP] + th[T_mDecP] * jmin(3, q / (0.5 * o.pool / std::max(1, o.nact))) : 1);
}
inline bool buysBack(const Obs& oA, Model& MA, int w, double q, const Th& th) {
  int A = oA.me, k = oA.ak;
  if (oA.out[A] || oA.money[A] < q) return false;
  return MA.util(A, {{A, k, 1}}, {{A, -q}, {w, q}}) > MA.util(A, {{w, k, 1}}, {{w, -q}, {A, q}}) * (1 + hurdle(oA, th, q));
}
inline void keennessOf(const Obs& o, double prior, double* out) {
  double lg[MAXP] = {0}, cnt[MAXP] = {0};
  for (const HistE& e : o.g->hist) {
    if (e.t != 'a') continue;
    for (int j = 0; j < MAXP; j++) {
      if (!e.hasPred[j]) continue;
      double pr = e.pred[j];
      if (pr < 20 || e.w == j) continue;
      int b = e.mx[j]; double r;
      if (b) r = b / pr; else if (e.p < pr) r = jmax(0.3, (e.p ? e.p : 10) / pr); else continue;
      lg[j] += mlog(clampd(r, 0.3, 3)); cnt[j]++;
    }
  }
  for (int j = 0; j < o.n; j++) out[j] = mexp(lg[j] / (cnt[j] + prior));
}
inline void keenness(Obs& o, double prior) { keennessOf(o, prior, o.keen); o.hasKeen = true; }
// Geometric mean keenness of the other players still in (1 when nothing is known yet).
inline double rivalKeen(const Obs& o) {
  double k[MAXP]; keennessOf(o, 4, k); double lg = 0; int n = 0;
  for (int x = 0; x < o.nact; x++) { int j = o.active[x]; if (j != o.me) { lg += mlog(k[j]); n++; } }
  return n ? mexp(lg / n) : 1;
}
struct Rival { int j; double c; };
inline vector<Rival> rivalLimits(const Obs& o, const Th& th) {
  vector<Rival> out;
  for (int x = 0; x < o.nact; x++) {
    int j = o.active[x];
    if (j == o.me || j == o.aA) continue;
    Obs oj = asSeenBy(o, j); Model Mj(oj, th);
    out.push_back({j, jmin(o.money[j], plainLimit(oj, th, Mj) * (o.hasKeen ? o.keen[j] : 1))});
  }
  return out;
}
inline double payment(const vector<int>* all, double q) { if (!all) return q; for (int v : *all) if (v >= q) return v; return INF; }
inline void buyBacks(const Game& s, int A, vector<std::pair<int, bool>>& out) {
  out.clear(); for (const HistE& e : s.hist) if (e.t == 'a' && e.A == A && e.p > 0) out.push_back({e.p, e.buy});
}
inline Bid bidPlan(const Obs& o, const Th& th, Model& M) { PROF("bidPlan");
  int me = o.me, k = o.ak, A = o.aA; double mine = tens(o.money[me]);
  vector<int> allv; const vector<int>* all = nullptr; if (o.hasHand) { allv = sums(o.hand); all = &allv; }
  if (mine < 10) return {0, 0};
  Obs oA = asSeenBy(o, A); Model MA(oA, th); vector<Rival> rivals = rivalLimits(o, th);
  vector<std::pair<int, bool>> bb; bool hasBB = th.t(T_openHist); if (hasBB) buyBacks(*o.g, A, bb);
  auto pBuy = [&](int w, double q) -> double {
    if (oA.out[A] || oA.money[A] < q) return 0;
    double r = MA.util(A, {{A, k, 1}}, {{A, -q}, {w, q}}) / jmax(1e-12, MA.util(A, {{w, k, 1}}, {{w, -q}, {A, q}})) - 1 - hurdle(oA, th, q);
    double pb = 1 / (1 + mexp(-r / th.d(T_openT, 0.05)));
    if (hasBB) { int n = 0, b = 0; for (auto [p, buy] : bb) if (buy ? p >= q : p <= q) { n++; if (buy) b++; } pb = (th[T_openHist] * pb + b) / (th[T_openHist] + n); }
    return pb;
  };
  auto sold = [&](int w, double q) { double pq = w == me ? payment(all, q) : q; return M.util(me, {{w, k, 1}}, {{w, -pq}, {A, pq}}); };
  auto soft = [&](int w, double q) { double pb = pBuy(w, q), s = sold(w, q); return pb > 0 ? pb * M.util(me, {{A, k, 1}}, {{A, -q}, {w, q}}) + (1 - pb) * s : s; };
  bool softCap = th.t(T_softCap);
  auto at = [&](int w, double q) { if (softCap) return soft(w, q); return buysBack(oA, MA, w, q, th) ? M.util(me, {{A, k, 1}}, {{A, -q}, {w, q}}) : sold(w, q); };
  auto other = [&](double q) {
    if (rivals.empty()) return M.util(me, {{A, k, 1}}, {});
    double u = 0, W = 0;
    for (const Rival& r : rivals) { double w = (r.c >= q ? 1 : 0.1) * (o.herd[r.j][k] + 0.5); u += w * at(r.j, q); W += w; }
    return u / W;
  };
  if (!(at(me, 10) > M.util(me, {{A, k, 1}}, {}))) return {0, 0};
  double cap = 10;
  for (double q = 20; q <= mine; q = q < 100 ? q + 10 : tens(q * 1.06) + 10) {
    if (!(at(me, q) >= other(q))) break;
    cap = q;
  }
  double sk = th.t(T_shadeK) ? mpow(rivalKeen(o), th[T_shadeK]) : 1;
  cap = jmin(tens(cap * th.d(T_shade, 1) * sk), mine);
  if (!th.t(T_open) || cap <= 10) return {cap, 0};
  static const double SPREAD[5][2] = {{0.55, 0.1}, {0.75, 0.2}, {1, 0.4}, {1.3, 0.2}, {1.7, 0.1}};
  vector<std::array<std::pair<double, double>, 5>> stops;
  for (const Rival& r : rivals) { std::array<std::pair<double, double>, 5> st; for (int x = 0; x < 5; x++) { double c = tens(jmin(o.money[r.j], r.c * SPREAD[x][0])); st[x] = {c >= 10 ? c : 0, SPREAD[x][1]}; } stops.push_back(st); }
  auto below = [&](double x) { double p = 1; for (const auto& st : stops) { double q = 0; for (auto [c, w] : st) q = q + (c < x ? w : 0); p = p * q; } return p; };
  vector<double> pts{0}; for (const auto& st : stops) for (auto [c, w] : st) pts.push_back(c);
  { vector<double> u; for (double v : pts) if (std::find(u.begin(), u.end(), v) == u.end()) u.push_back(v); pts = u; std::stable_sort(pts.begin(), pts.end(), [](double x, double y) { return x - y < 0; }); }
  vector<std::pair<double, double>> pmf;
  for (size_t x = 0; x < pts.size(); x++) pmf.push_back({pts[x], below(pts[x] + 10) - (x ? below(pts[x - 1] + 10) : 0)});
  vector<double> base; for (auto [l, p] : pmf) base.push_back(soft(me, jmax(10, l + 10)));
  double kept = M.util(me, {{A, k, 1}}, {{A, -10}, {me, 10}});
  double open = 0, bestGain = 0;
  for (double q = 20; q <= cap; q = q < 100 ? q + 10 : tens(q * 1.06) + 10) {
    double pq = payment(all, q);
    if (M.util(me, {{me, k, 1}}, {{me, -pq}, {A, pq}}) < kept) break;
    double g = 0, u = soft(me, q);
    for (size_t x = 0; x < pmf.size(); x++) { auto [l, p] = pmf[x]; if (l < q && p > 0) g += p * (u - base[x]); }
    if (g > bestGain) { bestGain = g; open = q; }
  }
  return {cap, bestGain > 1e-4 * std::fabs(M.util(me, {}, {})) ? open : 0};
}
inline bool buyBack(const Obs& o, const Th& th, Model& M) {
  int me = o.me, k = o.ak, b = o.highP; double p = o.highAmt; vector<int> sm = sums(o.hand); double pay = payment(&sm, p);
  if (o.money[me] < p) return false;
  return M.util(me, {{me, k, 1}}, {{me, -pay}, {b, pay}}) > M.util(me, {{b, k, 1}}, {{b, -p}, {me, p}}) * (1 + hurdle(o, th, p));
}
inline double auctionValue(const Obs& o, const Th& th) { PROF("auctionValue");
  int me = o.me, deck = o.deckLeft;
  if (!deck) return -INF;
  double tot = 0; for (int k = 0; k < NT; k++) tot += o.remain[k];
  if (!truthy(tot)) tot = 1;
  double ev = 0;
  for (int k = 0; k < NT; k++) {
    double pk = o.remain[k] / tot;
    if (pk <= 0) continue;
    Obs ok = o; ok.hasAuction = true; ok.ak = k; ok.aA = me; ok.hasHigh = false; ok.aStage = ST_BIDDING;
    ok.remain[k] = jmax(0, ok.remain[k] - 1); ok.seen[k]++;
    if (k == MULE && o.mules < 4) {
      int pay = MULE_PAY[o.mules];
      for (int x = 0; x < o.nact; x++) { int j = o.active[x]; ok.money[j] += pay; ok.seenAs[j] += pay; }
      ok.pool = o.pool + pay * o.nact; ok.mules = o.mules + 1; ok.hand.push_back(pay);
    }
    Model Mk(ok, th);
    double c1 = 0, c2 = 0; int w = -1;
    for (int x = 0; x < o.nact; x++) {
      int j = o.active[x]; if (j == me) continue;
      Obs oj = asSeenBy(ok, j); Model Mj(oj, th);
      double c = jmin(ok.money[j], plainLimit(oj, th, Mj) * (o.hasKeen ? o.keen[j] : 1));
      if (c > c1) { c2 = c1; c1 = c; w = j; } else if (c > c2) c2 = c;
    }
    double u;
    if (c1 < 10) u = Mk.util(me, {{me, k, 1}}, {});
    else {
      double q = jmax(10, jmin(c1, c2 + 10));
      double sell = Mk.util(me, {{w, k, 1}}, {{w, -q}, {me, q}}); vector<int> sm = sums(ok.hand); double pay = payment(&sm, q);
      u = ok.money[me] >= q ? jmax(sell, Mk.util(me, {{me, k, 1}}, {{me, -pay}, {w, pay}})) : sell;
    }
    ev += pk * u;
  }
  return ev;
}

// ---------------------------------------------------------------------------------------------------------------
// Koehandel.
inline vector<signed char> fewest(const vector<int>& hand) {
  int tot = isum(hand) / 10; vector<signed char> f(tot + 1, 99); f[0] = 0;
  for (int c : hand) { int d = c / 10; if (d) for (int v = tot; v >= d; v--) if (f[v - d] + 1 < f[v]) f[v] = (signed char)(f[v - d] + 1); }
  return f;
}
inline double gauss(Rng& rand) { double a = std::sqrt(-2 * mlog(1 - rand())); return a * mcos(2 * 3.141592653589793 * rand()); }
inline void shuffleE(vector<int>& a, Rng& rand) { for (int i = (int)a.size() - 1; i > 0; i--) { int j = (int)std::floor(rand() * (i + 1)); std::swap(a[i], a[j]); } }
struct WHand { vector<int> hand; double w; };
inline vector<WHand> guessHands(const vector<int>& pool, int count, double est, Rng& rand, int K = 8, double sd = 0, bool sharp = false) { PROF("guessHands");
  vector<WHand> out;
  if (!count) { out.push_back({{}, 1}); return out; }
  if (sharp) {
    for (int t = 0; t < K; t++) {
      vector<int> p = pool; shuffleE(p, rand);
      int cnt = std::min(count, (int)p.size());
      vector<int> h(p.begin(), p.begin() + cnt), rest(p.begin() + cnt, p.end());
      double target = est + sd * gauss(rand);
      double m = isum(h);
      for (int step = 0; step < 2 * count + 4; step++) {
        int bx = -1, by = -1; double bd = std::fabs(m - target);
        for (size_t x = 0; x < h.size(); x++) for (size_t y = 0; y < rest.size(); y++) {
          double d = std::fabs(m - h[x] + rest[y] - target);
          if (d < bd - 1e-9) { bd = d; bx = (int)x; by = (int)y; }
        }
        if (bx < 0) break;
        m += rest[by] - h[bx]; std::swap(h[bx], rest[by]);
      }
      out.push_back({h, 1.0 / K});
    }
    return out;
  }
  for (int t = 0; t < K * 3; t++) {
    vector<int> p = pool; shuffleE(p, rand);
    int cnt = std::min(count, (int)p.size()); p.resize(cnt);
    double m = isum(p);
    out.push_back({p, mexp(-std::fabs(m - est) / (20 + 0.15 * est + sd))});
  }
  std::stable_sort(out.begin(), out.end(), [](const WHand& a, const WHand& b) { return b.w - a.w < 0; });
  out.resize(std::min((int)out.size(), K));
  double W = 0; for (auto& x : out) W += x.w;
  if (!truthy(W)) W = 1;
  for (auto& x : out) x.w /= W;
  return out;
}
// insertion-ordered map amount -> weight (JS Map semantics for numeric keys)
struct OMap {
  vector<double> k, v; vector<int> idx; vector<int> odd;
  int find(double key) const {
    if (key >= 0 && key < 1e6 && std::floor(key / 10) * 10 == key) { size_t i = (size_t)(key / 10); return i < idx.size() ? idx[i] - 1 : -1; }
    for (int p : odd) if (k[p] == key) return p;
    return -1;
  }
  void add(double key, double w) { // m.set(key, (m.get(key) || 0) + w)
    int p = find(key);
    if (p >= 0) { v[p] = (truthy(v[p]) ? v[p] : 0) + w; return; }
    k.push_back(key); v.push_back(0 + w); p = (int)k.size() - 1;
    if (key >= 0 && key < 1e6 && std::floor(key / 10) * 10 == key) { size_t i = (size_t)(key / 10); if (idx.size() <= i) idx.resize(i + 1, 0); idx[i] = p + 1; } else odd.push_back(p);
  }
  size_t size() const { return k.size(); }
};
using Belief = vector<std::pair<double, double>>;
inline vector<vector<double>> subsetSums(const vector<int>& hand) {
  int C = (int)hand.size(), V = isum(hand) / 10; vector<vector<double>> dp(C + 1, vector<double>(V + 1, 0.0));
  dp[0][0] = 1; int top = 0;
  for (int idx = 0; idx < C; idx++) { int d = hand[idx] / 10; for (int n = idx; n >= 0; n--) { auto& row = dp[n]; auto& nxt = dp[n + 1]; for (int v = top; v >= 0; v--) if (row[v]) nxt[v + d] += row[v]; } top += d; }
  return dp;
}
struct OBelief { vector<OMap> S, A; vector<char> hasS, hasA;
  const OMap* getS(int n) const { return n >= 0 && n < (int)S.size() && hasS[n] ? &S[n] : nullptr; }
  const OMap* getA(int n) const { return n >= 0 && n < (int)A.size() && hasA[n] ? &A[n] : nullptr; }
};
inline void beliefAdd(vector<OMap>& m, vector<char>& has, int n, double v, double w) { if ((int)m.size() <= n) { m.resize(n + 1); has.resize(n + 1, 0); } has[n] = 1; m[n].add(v, w); }
inline OBelief offerBelief(const vector<WHand>& hands, double defMoney) { PROF("offerBelief");
  const double bluff = 0.15, sharp = 0.45; OBelief B;
  for (const auto& [hand, w] : hands) {
    auto f = fewest(hand); int m = isum(hand), zeros = 0; for (int c : hand) zeros += c == 0;
    vector<int> reach; for (int v = 0; v < (int)f.size(); v++) if (f[v] < 99) reach.push_back(v * 10);
    vector<std::pair<double, double>> T{{0, bluff}}; double aim = jmin(m, tens(defMoney) + 10);
    for (double r : {0.8, 1.0, 1.2}) T.push_back({jmin(m, tens(aim * r)), sharp / 3});
    double spread = 1 - bluff - sharp;
    for (int x = 1; x <= 8; x++) T.push_back({tens((double)m * x / 8), spread / 8});
    for (auto [t, wt] : T) {
      int v = reach.back(); for (int r : reach) if (r >= t) { v = r; break; }
      int n0 = f[v / 10];
      for (int p = 0; p <= zeros; p++) beliefAdd(B.S, B.hasS, n0 + p, v, (p == 0 ? 0.5 : 0.5 / zeros) * w * wt);
    }
    auto dp = subsetSums(hand);
    for (int n = 0; n < (int)dp.size(); n++) {
      double tot = 0; for (double x : dp[n]) tot += x;
      if (truthy(tot)) for (int v = 0; v < (int)dp[n].size(); v++) if (dp[n][v]) beliefAdd(B.A, B.hasA, n, v * 10, w * dp[n][v] / tot);
    }
  }
  return B;
}
inline OMap naiveBelief(int n, double m, double c) {
  OMap out;
  if (!n) { out.add(0, 1); return out; }
  static const double NAIVE[5][2] = {{0.3, 0.15}, {0.65, 0.2}, {1, 0.3}, {1.45, 0.2}, {2.1, 0.15}};
  double mean = jmin(m, n * m / jmax(1, c));
  for (auto& rw : NAIVE) { double x = jmin(m, tens(mean * rw[0])); out.add(x, rw[1]); }
  return out;
}
// a normalised mixture of beliefs; false = null
inline bool mixB(std::initializer_list<std::pair<const OMap*, double>> parts, Belief& res) { PROF("mixB");
  OMap acc;
  for (auto [m, w] : parts) {
    if (!m || !truthy(w)) continue;
    double tot = 0; for (double x : m->v) tot += x;
    if (truthy(tot)) for (size_t i = 0; i < m->k.size(); i++) { double v = m->k[i], x = m->v[i]; int p = acc.find(v); double prev = p >= 0 ? acc.v[p] : 0; double nv = (truthy(prev) ? prev : 0) + w * x / tot; if (p >= 0) acc.v[p] = nv; else acc.add(v, nv); }
  }
  double tot = 0; for (double x : acc.v) tot += x;
  res.clear();
  if (!truthy(tot)) return false;
  for (size_t i = 0; i < acc.k.size(); i++) res.push_back({acc.k[i], acc.v[i] / tot});
  return true;
}
// utility of `who` by the money it receives net, when `gets`/`other` win the animals (expert.js outcomes)
struct Outcomes {
  Model* M; int who, other, gets, A, B, k, c;
  // memo of util by d (a pure cache): a flat table for whole multiples of 10 within the money in play, a map otherwise
  int R; vector<double> tw, tl; std::unordered_map<double, double> mw, ml;
  Outcomes(Model* M_, int who_, int A_, int B_, int k_, int c_) : M(M_), who(who_), A(A_), B(B_), k(k_), c(c_) {
    other = who == A ? B : A; gets = who == A ? A : B;
    R = (int)M->mfTab.size() + 2; tw.assign(2 * R + 1, NaN); tl.assign(2 * R + 1, NaN);
  }
  double calc(int winner, double d) { int loser = winner == A ? B : A; return M->util(who, {{winner, k, c}, {loser, k, -c}}, {{who, d}, {other, -d}}); }
  double mk(int winner, vector<double>& t, std::unordered_map<double, double>& memo, double d) {
    double q = d / 10;
    if (q >= -R && q <= R && q == std::floor(q)) { double& v = t[(size_t)(q + R)]; if (v != v) v = calc(winner, d); return v; }
    auto it = memo.find(d); if (it != memo.end()) return it->second;
    double u = calc(winner, d); memo[d] = u; return u;
  }
  double win(double d) { return mk(gets, tw, mw, d); }
  double lose(double d) { return mk(other, tl, ml, d); }
};
struct Counter { bool hasY; double y, v, acc; };
inline Counter bestCounter(const Belief& belief, const vector<int>& amounts, Outcomes& U, bool ties) { PROF("bestCounter");
  double acc = 0; for (auto [x, w] : belief) acc += w * U.lose(x);
  bool has = false; double best = 0, bv = acc;
  // the sums per counter y, taken over the belief in order (belief outside, counters inside: every V[y] still adds up
  // in the same order as the plain loop)
  if (amounts.empty()) return {has, best, bv, acc};
  thread_local vector<double> V; V.assign(amounts.size(), 0.0);
  const double tie = ties ? U.lose(0) : 0.5 * (U.win(0) + U.lose(0));
  for (auto [x, w] : belief) {
    const double q = x / 10; const bool flat = q == std::floor(q) && q - amounts.back() / 10 >= -U.R && q <= U.R;
    if (flat) { // d = x - y is a whole multiple of 10 inside the memo tables
      const int xi = (int)q, R = U.R;
      for (size_t a = 0; a < amounts.size(); a++) {
        const int y = amounts[a]; if (y <= 0) continue;
        double t;
        if (y > x) { double& c = U.tw[(size_t)(xi - y / 10 + R)]; if (c != c) c = U.calc(U.gets, x - y); t = c; }
        else if (y < x) { double& c = U.tl[(size_t)(xi - y / 10 + R)]; if (c != c) c = U.calc(U.other, x - y); t = c; }
        else t = tie;
        V[a] += w * t;
      }
    } else for (size_t a = 0; a < amounts.size(); a++) { const int y = amounts[a]; if (y <= 0) continue; V[a] += w * (y > x ? U.win(x - y) : y < x ? U.lose(x - y) : tie); }
  }
  for (size_t a = 0; a < amounts.size(); a++) { if (amounts[a] <= 0) continue; if (V[a] > bv) { bv = V[a]; best = amounts[a]; has = true; } }
  return {has, best, bv, acc};
}
inline bool lastStand(const Obs& o, int j, int k, int c) {
  if (o.deckLeft) return false;
  int me = o.me;
  for (int d : {c, -c}) for (int t = 0; t < NT; t++) {
    int mine = o.herd[me][t] + (t == k ? d : 0);
    if (mine <= 0) continue;
    for (int x = 0; x < o.n; x++) if (x != me && o.herd[x][t] + (t == k && x == j ? -d : 0) > 0) return false;
  }
  return true;
}
struct Plan { bool ok = false; vector<int> cards; double ev = 0; };
inline Plan planOffer(const Obs& o, const Th& th, Model& M, int j, int k, int c, Rng& rand, bool rough = false) { PROF("planOffer");
  int me = o.me; const vector<int>& hand = o.hand; int settle = settling(o, me, j, k);
  vector<int> amounts = sums(hand); int zeros = 0; for (int x : hand) zeros += x == 0;
  Outcomes U(&M, me, me, j, k, c);
  if (settle < 0) return {true, {}, U.lose(0)};
  if (th.t(T_allIn) && hand.size() && lastStand(o, j, k, c)) return {true, hand, U.win(0)};
  bool sh = th.t(T_sharp); const vector<int>& myPool = o.unseen;
  auto defHands = guessHands(myPool, o.cards[j], o.money[j], rand, rough ? 2 : 3, sh ? o.sdS[j] : o.sd[j], sh);
  struct Scen { double w; vector<int> hB; OBelief belief; vector<int> amounts; std::unordered_map<int, vector<std::pair<std::pair<bool, double>, double>>> cache; };
  vector<Scen> scen;
  for (const auto& [hB, w] : defHands) {
    vector<int> poolB = myPool;
    for (int x : hB) { auto it = std::find(poolB.begin(), poolB.end(), x); if (it != poolB.end()) poolB.erase(it); else if (!poolB.empty()) poolB.pop_back(); }
    poolB.insert(poolB.end(), hand.begin(), hand.end());
    auto myHands = guessHands(poolB, (int)hand.size(), o.seenAs[j], rand, rough ? 4 : 6, sh ? o.sdSBy[j] : 0, sh);
    Scen sc; sc.w = w; sc.hB = hB; sc.belief = offerBelief(myHands, o.money[j]); sc.amounts = sums(hB);
    scen.push_back(std::move(sc));
  }
  Outcomes UB(&M, j, me, j, k, c); bool ties = o.hasTrade && o.tties;
  bool naive = th.t(T_naive);
  auto respond = [&](Scen& sc, int n) -> const vector<std::pair<std::pair<bool, double>, double>>& {
    auto it = sc.cache.find(n); if (it != sc.cache.end()) return it->second;
    const OMap* S = sc.belief.getS(n); const OMap* A = sc.belief.getA(n); OMap N = naiveBelief(n, o.seenAs[j], hand.size());
    Belief fallback{{jmin(o.money[me], n * 20), 1}};
    vector<std::pair<Belief, double>> bs; Belief b; bool ok;
    if (naive) { ok = mixB({{&N, 1}}, b); bs.push_back({ok ? b : fallback, 1}); }
    else {
      ok = mixB({{S, 0.45}, {A, 0.35}, {&N, 0.2}}, b); bs.push_back({ok ? b : fallback, 0.6});
      ok = mixB({{&N, 1}}, b); bs.push_back({ok ? b : fallback, 0.25});
      ok = mixB({{A, 1}}, b); if (!ok) ok = mixB({{&N, 1}}, b); bs.push_back({ok ? b : fallback, 0.15});
    }
    vector<std::pair<std::pair<bool, double>, double>> r;
    for (auto& [bl, w] : bs) { Counter ct = bestCounter(bl, sc.amounts, UB, ties); r.push_back({{ct.hasY, ct.y}, w}); }
    return sc.cache[n] = r;
  };
  Plan best;
  vector<int> cands;
  if (rough) { for (size_t x = 0; x < amounts.size(); x++) { int v = amounts[x]; if (v <= 100 || x % 3 == 0 || x == amounts.size() - 1) cands.push_back(v); } }
  else cands = amounts;
  int maxP = naive ? 0 : rough ? 1 : 3;
  for (int x : cands) {
    if (settle > 0 && x <= o.money[j] && x < o.money[me]) continue;
    vector<int> base = x ? cheapest(hand, x) : vector<int>();
    int free = zeros; for (int v : base) free -= v == 0;
    for (int p = 0; p <= std::min(free, maxP); p++) {
      int n = (int)base.size() + p;
      double ev = 0;
      for (auto& sc : scen) for (const auto& [yy, w] : respond(sc, n)) {
        auto [has, y] = yy;
        ev += sc.w * w * (!has ? U.win(-x) : y > x ? U.lose(y - x) : y < x ? U.win(y - x) : 0.5 * (U.win(0) + U.lose(0)));
      }
      if (!best.ok || ev > best.ev * (1 + 1e-9) || (ev > best.ev * (1 - 2e-3) && rand() < 0.3)) {
        best.ok = true; best.ev = ev; best.cards = base; for (int z = 0; z < p; z++) best.cards.push_back(0);
      }
    }
  }
  return best;
}
// Defender: accept (false) or the counter.
inline std::pair<bool, double> planCounter(const Obs& o, const Th& th, Model& M, Rng& rand) { PROF("planCounter");
  int me = o.me, a = o.ta, k = o.tk, c = o.tcount, settle = settling(o, me, a, k);
  if (settle < 0) return {false, 0};
  if (th.t(T_allIn) && isum(o.hand) > 0 && lastStand(o, a, k, c)) return {true, (double)isum(o.hand)};
  Outcomes U(&M, me, a, me, k, c);
  auto hands = guessHands(o.unseen, o.cards[a], o.money[a], rand, 10, th.t(T_sharp) ? o.sdS[a] : o.sd[a], th.t(T_sharp));
  OBelief belief = offerBelief(hands, o.seenAs[a]); int n = o.toffer;
  OMap N = naiveBelief(n, o.money[a], o.cards[a]);
  Belief b; bool ok = th.t(T_naive) ? mixB({{&N, 1}}, b) : mixB({{belief.getS(n), 0.45}, {belief.getA(n), 0.35}, {&N, 0.2}}, b);
  if (!ok) b = {{jmin(o.money[a], n * 20), 1}};
  if (o.hasTieAt) for (auto& [x, w] : b) x = jmax(x, o.tieAt);
  vector<int> amounts = sums(o.hand);
  if (settle > 0) { double top = -INF; for (auto& [x, w] : b) top = jmax(top, x); for (int y : amounts) if (y > top) return {true, (double)y}; return {false, 0}; }
  Counter ct = bestCounter(b, amounts, U, o.tties);
  return {ct.hasY, ct.y};
}
// The same two decisions by solving the koehandel (solver.h).
inline vector<WHand> typesFor(const vector<int>& pool, int count, double est, Rng& rand, int K, double sd, const vector<int>* own, bool sharp) {
  auto hs = guessHands(pool, count, est, rand, K, sd, sharp);
  if (!own) return hs;
  double so = isum(*own);
  double w0 = sharp ? mexp(-0.5 * (((so - est) / (sd + 10)) * ((so - est) / (sd + 10)))) : mexp(-std::fabs(so - est) / (20 + 0.15 * est + sd));
  double top = 1; if (hs.size()) { top = -INF; for (auto& h : hs) top = jmax(top, h.w); }
  vector<WHand> out; out.push_back({*own, jmin(1, w0 / jmax(1e-9, top)) * (1.0 / std::max(1, (int)hs.size()))});
  for (auto& h : hs) out.push_back({h.hand, h.w});
  double W = 0; for (auto& x : out) W += x.w;
  for (auto& x : out) x.w /= W;
  return out;
}
inline vector<int> without(const vector<int>& pool, const vector<int>& hand) {
  vector<int> p = pool; for (int x : hand) { auto it = std::find(p.begin(), p.end(), x); if (it != p.end()) p.erase(it); } return p;
}
struct HabitA { double trust, pa, r, mb, gate; int ns, nc; };
inline bool answerHabit(const Obs& o, int b, HabitA& h, bool all) {
  int acc = 0, m = 0, ns = 0, nc = 0; double ys = 0;
  for (const HistE& e : o.g->hist) if (e.t == 'k' && e.b == b && e.na && (all || e.a == o.me)) {
    m++; if (e.nb < 0) acc++; else if (e.a == o.me && e.y >= 0) { ys += e.y; ns += e.na; } else nc++;
  }
  if (!m) return false;
  h.pa = (acc + 0.5) / (m + 1); h.r = ns ? ys / ns / 10 : 0; h.ns = ns; h.nc = nc; h.mb = o.money[b]; h.trust = (double)m / (m + 3); h.gate = all ? jmin(1, jmax(0, 2 * (acc + 1.0) / (m + 3) - 1)) : 1;
  return true;
}
struct HabitO { double trust, r; };
inline bool offerHabit(const Obs& o, int a, HabitO& h) {
  double x = 0; int n = 0, m = 0;
  for (const HistE& e : o.g->hist) if (e.t == 'k' && e.a == a && e.b == o.me && e.na) { x += e.x; n += e.na; m++; }
  if (!m) return false;
  h.r = x / n / 10; h.trust = (double)m / (m + 3);
  return true;
}
inline std::unique_ptr<solver::Game> koehandelGame(const Obs& o, const Th& th, Model& M, int A, int B, int k, int c, Rng& rand, bool rough) { PROF("koehandelGame");
  int me = o.me; int K = (int)jround(rough ? th.o(T_roughK, 5) : th.o(T_solveK, 9)), iters = (int)jround(rough ? th.o(T_roughIt, 25) : th.o(T_solveIt, 45));
  bool ties = o.hasTrade && o.tties; double floor = o.hasTrade && o.hasTieAt ? o.tieAt : 0;
  bool sh = th.t(T_sharp); const double* sd = sh ? o.sdS : o.sd;
  auto theirs = [&](int j, double est, double s0) {
    if (th.t(T_trackHands) && o.track) { vector<std::pair<Hand, double>> hs; o.track->hands(j, K, rand, hs); vector<WHand> out; for (auto& [h, w] : hs) out.push_back({h, w}); return out; }
    return guessHands(o.unseen, o.cards[j], est, rand, K, s0, sh);
  };
  vector<int> all = o.unseen; all.insert(all.end(), o.hand.begin(), o.hand.end());
  vector<WHand> aT, bT;
  if (me == A) {
    bT = theirs(B, o.money[B], sd[B]);
    aT = typesFor(without(all, bT[0].hand), (int)o.hand.size(), o.seenAs[B], rand, K, sh ? o.sdSBy[B] : 0, &o.hand, sh);
  } else {
    aT = theirs(A, o.money[A], sd[A]);
    bT = typesFor(without(all, aT[0].hand), (int)o.hand.size(), o.seenAs[A], rand, K, sh ? o.sdSBy[A] : 0, &o.hand, sh);
  }
  auto g = std::make_unique<solver::Game>();
  solver::Input& in = g->in;
  for (auto& t : aT) in.aT.push_back({t.hand, t.w});
  for (auto& t : bT) in.bT.push_back({t.hand, t.w});
  int X = 0; for (const auto* T : {&in.aT, &in.bT}) for (const auto& t : *T) X = std::max(X, isum(t.hand) / 10);
  Outcomes UA(&M, A, A, B, k, c), UB(&M, B, A, B, k, c);
  in.aW = solver::table(X, [&](double d) { return UA.win(d); }); in.aL = solver::table(X, [&](double d) { return UA.lose(d); });
  in.bW = solver::table(X, [&](double d) { return UB.win(d); }); in.bL = solver::table(X, [&](double d) { return UB.lose(d); });
  in.ties = ties; in.floor = (int)floor; in.iters = iters; in.eps = th.d(T_solveEps, 0.06); in.maxPad = (int)th.o(T_solvePad, 5);
  HabitO hb; if (me == B && th.t(T_habits) && offerHabit(o, A, hb)) {
    double r = hb.r;
    in.habit = [r](int kk, vector<std::pair<double, double>>& out) {
      if (!kk) { out.push_back({0, 1}); return; }
      for (auto fp : {std::pair<double, double>{0.5, 0.25}, {1, 0.5}, {1.6, 0.25}}) out.push_back({jround(r * kk * fp.first), fp.second});
    };
    in.habitW = th[T_habits] * hb.trust;
  }
  HabitA ha; if (me == A && th.t(T_habitsA) && answerHabit(o, B, ha, th.t(T_habitsAll))) {
    HabitA h = ha;
    in.answers = [h](int n, vector<std::pair<double, double>>& out) {
      if (!h.ns && !h.nc) { out.push_back({-1, 1}); return; }
      out.push_back({-1, h.pa});
      if (!h.ns) { for (auto fp : {std::pair<double, double>{0.5, 0.3}, {0.8, 0.4}, {1, 0.3}}) out.push_back({jmax(1, jround(h.mb * fp.first / 10)), (1 - h.pa) * fp.second}); return; }
      for (auto fp : {std::pair<double, double>{0.7, 0.3}, {1, 0.4}, {1.4, 0.3}}) out.push_back({jmax(1, jround(h.r * std::max(1, n) * fp.first)), (1 - h.pa) * fp.second});
    };
    in.answersW = th[T_habitsA] * ha.trust * ha.gate;
  }
  g->solve();
  return g;
}
inline Plan solvedOffer(const Obs& o, const Th& th, Model& M, int j, int k, int c, Rng& rand, bool rough = false) {
  int me = o.me, settle = settling(o, me, j, k); Outcomes U(&M, me, me, j, k, c);
  if (settle < 0) return {true, {}, U.lose(0)};
  if (th.t(T_allIn) && o.hand.size() && lastStand(o, j, k, c)) return {true, o.hand, U.win(0)};
  auto g = koehandelGame(o, th, M, me, j, k, c, rand, rough);
  const auto& a = g->A[0]; vector<double> vals = g->valueOf(0);
  int bi = 0; for (int i = 0; i < (int)vals.size(); i++) if (vals[i] > vals[bi]) bi = i;
  if (settle > 0) { for (int i = 0; i < (int)a.ax.size(); i++) if (a.ax[i] * 10 > o.money[j]) { bi = i; break; } }
  double best = vals[bi], tol = std::fabs(best) * 2e-3; vector<double> mx = g->mix(0);
  auto few = fewest(o.hand);
  auto pad = [&](int i) { double f = a.ax[i] < (int)few.size() ? few[a.ax[i]] : 0; return jmax(0, a.an[i] - f); };
  double padCost = th.d(T_padCost, 0);
  auto adj = [&](int i) { return vals[i] - padCost * tol * pad(i); };
  double bestAdj = -INF; for (int i = 0; i < (int)a.ax.size(); i++) bestAdj = jmax(bestAdj, adj(i));
  double W = 0; vector<std::pair<int, double>> ok;
  for (int i = 0; i < (int)a.ax.size(); i++) if (adj(i) >= bestAdj - tol && vals[i] >= best - tol) { double w = mx[i] + 0.02; ok.push_back({i, w}); W += w; }
  double r = rand() * W; int pick = bi;
  if (settle <= 0) for (auto [i, w] : ok) { r -= w; if (r <= 0) { pick = i; break; } }
  int x = a.ax[pick], n = a.an[pick];
  bool okc; vector<int> cards = solver::cardsFor(o.hand, x * 10, n, okc);
  if (!okc) cards = cheapest(o.hand, x * 10);
  return {true, cards, best};
}
inline std::pair<bool, double> solvedCounter(const Obs& o, const Th& th, Model& M, Rng& rand) {
  int me = o.me, a = o.ta, k = o.tk, c = o.tcount, settle = settling(o, me, a, k);
  if (settle < 0) return {false, 0};
  if (th.t(T_allIn) && isum(o.hand) > 0 && lastStand(o, a, k, c)) return {true, (double)isum(o.hand)};
  auto g = koehandelGame(o, th, M, a, me, k, c, rand, false);
  if (settle > 0) {
    auto post = g->posterior(o.toffer); double top = -INF; for (auto& p : post) top = jmax(top, p.first); top *= 10;
    for (int y : sums(o.hand)) if (y > top) return {true, (double)y};
    return {false, 0};
  }
  int y = g->answer(o.hand, o.toffer);
  return y < 0 ? std::pair<bool, double>{false, 0} : std::pair<bool, double>{true, (double)y * 10};
}
struct KOpt { int p, k, count; double ev; };
inline vector<KOpt> koehandelOptions(const Obs& o, const Th& th, Model& M, Rng& rand) {
  vector<KOpt> out;
  for (const Tgt& t : targetsOf(o)) {
    if (o.out[t.p]) { out.push_back({t.p, t.k, t.count, M.util(o.me, {{o.me, t.k, t.count}, {t.p, t.k, -t.count}}, {}) * 2}); continue; }
    Plan plan = th.t(T_solve) ? solvedOffer(o, th, M, t.p, t.k, t.count, rand, true) : planOffer(o, th, M, t.p, t.k, t.count, rand, true);
    if (!plan.ok) throw JsThrow{"TypeError: plan is null"};
    out.push_back({t.p, t.k, t.count, plan.ev * (1 - 0.1 * repeats(o, o.me, t.p, t.k))});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Personality per seat, settings by deck size, and the player.
struct Style { double keen; int fav[2]; double favBy, kh, mDec; };
inline bool styleOf(const Game& s, int i, double spread, Style& y) {
  if (!truthy(spread)) return false;
  uint32_t h = (uint32_t)(s.seed ^ 0x2545f491);
  auto r = [&]() { h = (h ^ (h >> 15)) * 0x2c1b3c6du + 0x9e3779b9u + (uint32_t)i * 0x632be5abu; h ^= h >> 12; return (double)h / 4294967296.0; };
  for (int x = 0; x < 4 + i; x++) r();
  int f1 = (int)std::floor(r() * 10); int f2 = (f1 + 1 + (int)std::floor(r() * 9)) % 10;
  y.fav[0] = f1; y.fav[1] = f2;
  y.keen = 1 + spread * (r() * 2 - 1) * 0.12;
  y.favBy = 1 + spread * 0.12 * r();
  y.kh = spread * (r() * 2 - 1) * 0.04;
  y.mDec = spread * (r() * 2 - 1) * 0.02;
  return true;
}
inline Th forDeck(const Th& th, int size) {
  if (!th.small) return th;
  double f = clampd((30.0 - size) / 10, 0, 1); Th out = th;
  for (int k = 0; k < NK; k++) if (th.small->h(k)) out.set(k, th[k] + f * ((*th.small)[k] - th[k]));
  return out;
}

class ExpertAgent : public Agent {
 public:
  Th th0; double noise, slip; std::unordered_map<int, Th> sized;
  ExpertAgent(const Th& th, double noise_ = 0, double slip_ = 0) : th0(th), noise(noise_), slip(slip_) {}
  bool hasBid() const override { return true; }
  bool isPerson() const override { return th0.t(T_person); }
  double blur(double x, Rng& rand) { return truthy(noise) ? x * mexp(noise * gauss(rand) - noise * noise / 2) : x; }
  void seat(const Game& s, int i, Th& th, bool& hasY, Style& y) {
    int size = s.deckSize;
    auto it = sized.find(size); if (it == sized.end()) it = sized.emplace(size, forDeck(th0, size)).first;
    th = it->second;
    if (th0.solo) { // th.solo: when all the others are people (expertAgent in expert.js)
      bool all = true; for (int j = 0; j < s.n; j++) if (j != i && !s.person[j]) all = false;
      if (all) { Th so = *th0.solo; so.small = nullptr; so.solo = nullptr; th.merge(so); }
    }
    const Th th1 = th;
    hasY = styleOf(s, i, th1.z(T_style), y);
    if (hasY) { th.set(T_shade, th1.d(T_shade, 1) * y.keen); th.set(T_mDec, th1.z(T_mDec) + y.mDec); }
  }
  Bid bid(Game& s, int i, Rng& rand) override {
    Th th; bool hasY; Style y; seat(s, i, th, hasY, y);
    Obs o; look(s, i, &th, o);
    if (th.t(T_adapt)) keenness(o, th[T_adapt]);
    Model M(o, th);
    Bid p = bidPlan(o, th, M); double c0 = p.cap;
    double c = truthy(noise) && truthy(c0) ? jmax(10, jmin(tens(o.money[i]), tens(blur(c0, rand)))) : c0;
    if (hasY && (y.fav[0] == o.ak || y.fav[1] == o.ak)) c = jmin(tens(o.money[i]), tens(c * y.favBy));
    return {c, jmin(p.open, c)};
  }
  double cap(Game& s, int i, Rng& rand) override { return bid(s, i, rand).cap; }
  Move act(Game& s, int i, int what, Rng& rand) override {
    Th th; bool hasY; Style y; seat(s, i, th, hasY, y);
    Obs o; look(s, i, &th, o); Model M(o, th);
    if (th.t(T_adapt)) keenness(o, th[T_adapt]);
    if (what == W_PAY) return mvCards(MV_PAY, cheapest(o.hand, s.au.highAmt));
    if (what == W_DECIDE) return mvType(buyBack(o, th, M) ? MV_BUY : MV_SELL);
    if (what == W_TURN) {
      if (truthy(slip) && rand() < slip) {
        auto ts = targetsOf(o);
        if (!o.deckLeft || (ts.size() && rand() < 0.3)) {
          int idx = (int)std::floor(rand() * ts.size());
          if (idx >= (int)ts.size()) throw JsThrow{"TypeError: t is undefined"};
          Move m; m.type = MV_KOEHANDEL; m.target = ts[idx].p; m.animal = ts[idx].k; return m;
        }
        return mvType(MV_AUCTION);
      }
      bool has = false; double bv = 0; Move ba;
      if (o.deckLeft) { has = true; bv = auctionValue(o, th); ba = mvType(MV_AUCTION); }
      double bias = 1 + (hasY ? y.kh : 0) + th.z(T_khBias);
      auto opts = koehandelOptions(o, th, M, rand);
      for (const auto& t : opts) {
        const double b = th.h(T_khBiasP) && s.person[t.p] ? bias - th.z(T_khBias) + th[T_khBiasP] : bias; // khBiasP: against a person
        if (!has || t.ev * b > bv) { has = true; bv = t.ev * b; ba = Move(); ba.type = MV_KOEHANDEL; ba.target = t.p; ba.animal = t.k; }
      }
      if (!has) throw JsThrow{"TypeError: best is null"};
      return ba;
    }
    if (what == W_OFFER) {
      if (th.t(T_boldP) && rand() < th[T_boldP]) return mvCards(MV_TRADEBID, o.hand); // a stand-in for people who offer everything
      Plan pl = th.t(T_solve) ? solvedOffer(o, th, M, o.tb, o.tk, o.tcount, rand) : planOffer(o, th, M, o.tb, o.tk, o.tcount, rand);
      if (!pl.ok) throw JsThrow{"TypeError: plan is null"};
      if (!truthy(noise)) return mvCards(MV_TRADEBID, pl.cards);
      int sc = isum(pl.cards); double x = 0;
      for (int v : sums(o.hand)) if (v >= tens(blur(sc, rand))) { x = v; break; } // (the blur is drawn anew for every amount tried)
      return mvCards(MV_TRADEBID, truthy(x) ? cheapest(o.hand, x) : vector<int>());
    }
    if (th.t(T_acceptP) && rand() < th[T_acceptP]) return mvType(MV_ACCEPT); // a stand-in for people who always accept
    auto yv = th.t(T_solve) ? solvedCounter(o, th, M, rand) : planCounter(o, th, M, rand);
    if (yv.first && truthy(noise)) {
      double found = NaN; bool f = false;
      for (int v : sums(o.hand)) if (v >= jmax(10, tens(blur(yv.second, rand)))) { found = v; f = true; break; }
      double r = jmin(o.money[i], f ? found : yv.second);
      yv = truthy(r) ? std::pair<bool, double>{true, r} : std::pair<bool, double>{false, 0};
    }
    return !yv.first ? mvType(MV_ACCEPT) : mvCards(MV_TRADEBID, cheapest(o.hand, yv.second));
  }
};
}  // namespace kh
