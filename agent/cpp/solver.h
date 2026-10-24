// lib/bots/solver.js: the koehandel as a game of hidden hands, solved by fictitious play (the kernel as in
// agent/cpp/solve.cpp), plus what the bots read from the solution (posterior, answer, valueOf, mix) and cardsFor.
#pragma once
#include <functional>
#include <map>
#include "common.h"

namespace kh {
namespace solver {
const int NEG = -1;
using PD = std::pair<int, double>;

inline vector<uint32_t> reachable(const vector<int>& hand) {
  int tot = 0; for (int c : hand) tot += c; tot /= 10;
  vector<uint32_t> reach(tot + 1, 0); reach[0] = 1;
  for (int c : hand) { int d = c / 10; for (int v = tot; v >= d; v--) if (reach[v - d]) reach[v] |= reach[v - d] << 1; }
  return reach;
}
inline vector<int> grid(const vector<int>& vals, int fine = 20, double ratio = 1.1) {
  vector<int> out;
  for (size_t i = 0; i < vals.size(); i++) { int v = vals[i]; if (v <= fine || out.empty() || v >= out.back() * ratio || v == vals.back()) out.push_back(v); }
  return out;
}
inline vector<vector<PD>> anyBelief(const vector<int>& hand, int maxN) {
  int C = std::min((int)hand.size(), maxN), V = 0; for (int c : hand) V += c; V /= 10;
  vector<vector<double>> dp(C + 1, vector<double>(V + 1, 0.0)); dp[0][0] = 1;
  int top = 0;
  for (int c : hand) { int d = c / 10; for (int n = C - 1; n >= 0; n--) { auto& row = dp[n]; auto& nxt = dp[n + 1]; for (int v = top; v >= 0; v--) if (row[v]) nxt[v + d] += row[v]; } top += d; }
  vector<vector<PD>> out(C + 1);
  for (int n = 0; n <= C; n++) { double tot = 0; for (double x : dp[n]) tot += x; if (tot) for (int v = 0; v <= V; v++) if (dp[n][v]) out[n].push_back({v, dp[n][v] / tot}); }
  return out;
}
// The cards that make exactly x with n cards (or none: ok = false).
inline vector<int> cardsFor(const vector<int>& hand, int x, int n, bool& ok) {
  vector<int> h = hand; std::stable_sort(h.begin(), h.end(), [](int a, int b) { return b - a < 0; });
  int V = x / 10, C = (int)h.size();
  auto key = [&](int v, int c) { return v * (C + 1) + c; };
  vector<vector<unsigned char>> can; can.push_back(vector<unsigned char>((V + 1) * (C + 1), 0));
  can[0][key(0, 0)] = 1;
  for (int i = 0; i < C; i++) {
    vector<unsigned char> cur = can[i]; const auto& prev = can[i]; int d = h[i] / 10;
    for (int v = V; v >= d; v--) for (int c = 1; c <= i + 1; c++) if (prev[key(v - d, c - 1)]) cur[key(v, c)] = 1;
    can.push_back(std::move(cur));
  }
  ok = n <= C && n >= 0 && can[C][key(V, n)];
  vector<int> out; if (!ok) return out;
  int v = V, c = n;
  for (int i = C; i > 0; i--) { if (can[i - 1][key(v, c)]) continue; out.push_back(h[i - 1]); v -= h[i - 1] / 10; c--; }
  return out;
}

struct Type { vector<int> hand; double w; };
struct AType { double w; vector<int> ax, an; vector<double> cnt, sumV; double tot; vector<vector<PD>> anyN; };
using DistFn = std::function<void(int n, vector<std::pair<double, double>>& out)>;
struct Input {
  vector<Type> aT, bT; int X = 0; vector<double> aW, aL, bW, bL; bool ties = false; int floor = 0, iters = 40; double eps = 0.06;
  int maxN = 30, maxPad = 5; DistFn habit; double habitW = 0; DistFn answers; double answersW = 0;
};
// utility tables by net money (units of 10), exact up to 30 then on knots about 8% apart, interpolated between
inline vector<double> table(int X, const std::function<double(double)>& f) {
  vector<int> knots;
  for (int d = 0; d <= X; d = d < 30 ? d + 1 : (int)jmin(X, jmax(d + 1, jround(d * 1.08)))) { knots.push_back(d); if (d == X) break; }
  vector<double> a(2 * X + 1, 0.0);
  for (int sg : {1, -1}) {
    int pd = -1; double pv = 0;
    for (int d : knots) {
      double v = f((double)(sg * d * 10)); a[sg * d + X] = v;
      if (pd >= 0 && d - pd > 1) for (int e = pd + 1; e < d; e++) a[sg * e + X] = pv + (v - pv) * (e - pd) / (d - pd);
      pd = d; pv = v;
    }
  }
  return a;
}

struct Game {
  Input in; int X = 0, N = 0; vector<AType> A; vector<int> U; struct BType { double w; vector<int> idx; }; vector<BType> B;
  vector<vector<vector<int>>> byN; vector<int> G, snap; vector<vector<double>> anyP, anyX;
  vector<double> px, pxx, postX, postP; int postLen = 0; vector<int> postXi;
  // vA, vB as flat tables by the difference (answers y >= 0): ca[X + y - x], cb[X + x - y]
  vector<double> ca, cb; vector<double> Rt; double aTie = 0, bTie = 0;
  std::map<int, vector<std::pair<double, double>>> ansCache;

  double vA(int x, int y) const { const double* aW = in.aW.data(); const double* aL = in.aL.data(); return y < 0 ? aW[X - x] : y > x ? aL[X + y - x] : y < x ? aW[X + y - x] : aTie; }
  double vB(int x, int y) const { const double* bW = in.bW.data(); const double* bL = in.bL.data(); return y < 0 ? bL[X + x] : y > x ? bW[X + x - y] : y < x ? bL[X + x - y] : bTie; }
  void post(int n) {
    const int nG = (int)G.size();
    if (n <= N) { std::copy(anyP[n].begin(), anyP[n].end(), px.begin()); std::copy(anyX[n].begin(), anyX[n].end(), pxx.begin()); }
    else { std::fill(px.begin(), px.end(), 0.0); std::fill(pxx.begin(), pxx.end(), 0.0); }
    if (n <= N) for (size_t m = 0; m < A.size(); m++) {
      const auto& a = A[m]; const double f = a.w * (1 - in.eps) / a.tot;
      for (int i : byN[m][n]) { int x = a.ax[i], g = snap[x]; double c = f * a.cnt[i]; px[g] += c; pxx[g] += c * x; }
    }
    double tot = 0; for (int g = 0; g < nG; g++) tot += px[g];
    postLen = 0;
    if (!tot) { postX[0] = jmin(X, jmax(in.floor / 10.0, n * 2.0)); postP[0] = 1; postLen = 1; return; }
    for (int g = 0; g < nG; g++) if (px[g] > 0) { postX[postLen] = jround(pxx[g] / px[g]); postP[postLen++] = px[g] / tot; }
  }
  const vector<std::pair<double, double>>& ans(int n) { auto it = ansCache.find(n); if (it != ansCache.end()) return it->second; auto& v = ansCache[n]; in.answers(n, v); return v; }
  double value(int m, int i) {
    const auto& a = A[m]; int n = a.an[i];
    double v = Rt[n] ? a.sumV[i] / Rt[n] : 0;
    if (in.answers && in.answersW > 0) { double h = 0; for (auto [y, p] : ans(n)) h += p * vA(a.ax[i], y < 0 ? NEG : (int)jmin(X, y)); v = (1 - in.answersW) * v + in.answersW * h; }
    return v;
  }
  vector<double> valueOf(int m) { vector<double> out; for (size_t i = 0; i < A[m].ax.size(); i++) out.push_back(value(m, (int)i)); return out; }
  vector<double> mix(int m) const { double t = 0; for (double c : A[m].cnt) t += c; vector<double> out; for (double c : A[m].cnt) out.push_back(c / t); return out; }
  vector<std::pair<double, double>> posterior(int n) { post(n); vector<std::pair<double, double>> out; for (int i = 0; i < postLen; i++) out.push_back({postX[i], postP[i]}); return out; }
  int answer(const vector<int>& hand, int n) {
    auto r = reachable(hand); vector<int> ys{NEG}; for (int v = 1; v < (int)r.size(); v++) if (r[v]) ys.push_back(v);
    post(n); vector<double> Ev(ys.size());
    for (size_t u = 0; u < ys.size(); u++) { int y = ys[u]; double v = 0; for (int i = 0; i < postLen; i++) v += postP[i] * vB((int)postX[i], y); Ev[u] = v; }
    int best = 0; for (int i = 1; i < (int)ys.size(); i++) if (Ev[i] > Ev[best] + 1e-12) best = i;
    return ys[best];
  }

  // E[u] = sum over the posterior of postP[i] * vB(postX[i], U[u]), i in order (U[0] = NEG)
  void worthAll(double* E, int nU) {
    for (int u = 0; u < nU; u++) E[u] = 0;
    for (int i = 0; i < postLen; i++) {
      const double p = postP[i]; const int x = (int)postX[i];
      E[0] += p * in.bL[X + x];
      const double* cx = cb.data() + X + x;
      for (int u = 1; u < nU; u++) E[u] += p * cx[-U[u]];
    }
  }
  void solve() { PROF("solve");
    X = 0; for (const auto* T : {&in.aT, &in.bT}) for (const auto& t : *T) { int s = 0; for (int c : t.hand) s += c; X = std::max(X, s / 10); }
    // (the tables are built by the caller with table(X, ...))
    aTie = in.ties ? in.aW[X] : 0.5 * (in.aW[X] + in.aL[X]); bTie = in.ties ? in.bL[X] : 0.5 * (in.bW[X] + in.bL[X]);
    ca.assign(2 * X + 1, 0); cb.assign(2 * X + 1, 0);
    for (int e = -X; e <= X; e++) { ca[X + e] = e > 0 ? in.aL[X + e] : e < 0 ? in.aW[X + e] : aTie; cb[X + e] = e < 0 ? in.bW[X + e] : e > 0 ? in.bL[X + e] : bTie; }
    N = 0;
    for (const auto& t : in.aT) {
      auto r = reachable(t.hand); vector<int> xs; for (int v = 0; v < (int)r.size(); v++) if (r[v]) xs.push_back(v);
      AType a; a.w = t.w; int hn = (int)t.hand.size();
      for (int x : grid(xs)) {
        if (x * 10 < in.floor) continue;
        int kept = 0;
        for (int n = 0; n <= std::min(in.maxN, hn) && kept < in.maxPad; n++) if ((r[x] >> n) & 1) { a.ax.push_back(x); a.an.push_back(n); kept++; if (n > N) N = n; }
      }
      if (a.ax.empty()) { int n = std::min(in.maxN, hn); a.ax.push_back(xs.back()); a.an.push_back(n); if (n > N) N = n; }
      a.cnt.assign(a.ax.size(), 1.0 / a.ax.size()); a.tot = 1; a.anyN = anyBelief(t.hand, in.maxN); a.sumV.assign(a.ax.size(), 0.0);
      A.push_back(std::move(a));
    }
    U = {NEG}; vector<int> uOf(X + 2, -1);
    for (const auto& t : in.bT) {
      auto r = reachable(t.hand); vector<int> ys; for (int v = 1; v < (int)r.size(); v++) if (r[v]) ys.push_back(v);
      BType b; b.w = t.w; b.idx.push_back(0);
      for (int y : grid(ys)) { if (uOf[y] < 0) { uOf[y] = (int)U.size(); U.push_back(y); } b.idx.push_back(uOf[y]); }
      B.push_back(std::move(b));
    }
    const int nA = (int)A.size(), nB = (int)B.size(), nU = (int)U.size();
    byN.assign(nA, vector<vector<int>>(N + 1));
    for (int m = 0; m < nA; m++) for (int i = 0; i < (int)A[m].ax.size(); i++) byN[m][A[m].an[i]].push_back(i);
    vector<int> all(X + 1); for (int v = 0; v <= X; v++) all[v] = v;
    G = grid(all); const int nG = (int)G.size();
    snap.assign(X + 1, 0);
    for (int v = 0, gi = 0; v <= X; v++) { while (gi + 1 < nG && G[gi + 1] <= v) gi++; snap[v] = gi; }
    anyP.assign(N + 1, vector<double>(nG, 0.0)); anyX.assign(N + 1, vector<double>(nG, 0.0));
    for (const auto& a : A) for (int n = 0; n <= N; n++) {
      if (n >= (int)a.anyN.size() || a.anyN[n].empty()) continue;
      for (auto [x, p] : a.anyN[n]) if (x * 10 >= in.floor) { anyP[n][snap[x]] += a.w * in.eps * p; anyX[n][snap[x]] += a.w * in.eps * p * x; }
    }
    if (in.habit && in.habitW > 0) {
      vector<std::pair<double, double>> hv;
      for (int n = 0; n <= N; n++) { hv.clear(); in.habit(n, hv); for (auto [x0, p] : hv) {
        int x = (int)jmin(X, jmax(std::ceil(in.floor / 10.0), x0)); anyP[n][snap[x]] += in.habitW * p; anyX[n][snap[x]] += in.habitW * p * x; } }
    }
    px.assign(nG, 0); pxx.assign(nG, 0); postX.assign(nG, 0); postP.assign(nG, 0);
    vector<double> E(nU); Rt.assign(N + 1, 0.0);
    vector<vector<int>> last(N + 1, vector<int>(nB, 0)); vector<char> seen(N + 1, 0), played(N + 1, 0);
    vector<int> addU(nB); vector<double> addW(nB); size_t maxActs = 0; for (auto& a : A) maxActs = std::max(maxActs, a.ax.size()); vector<double> acc(maxActs + 1);
    for (int it = 1; it <= in.iters; it++) {
      for (int n = 0; n <= N; n++) {
        auto& ln = last[n];
        if (played[n] || !seen[n]) {
          post(n);
          worthAll(E.data(), nU);
          seen[n] = 1;
          for (int bi = 0; bi < nB; bi++) { const auto& idx = B[bi].idx; int best = idx[0]; for (int u : idx) if (E[u] > E[best] + 1e-12) best = u; ln[bi] = best; }
        }
        int na = 0;
        for (int bi = 0; bi < nB; bi++) { int u = ln[bi], z = 0; while (z < na && addU[z] != u) z++; if (z == na) { addU[na] = u; addW[na++] = B[bi].w; } else addW[z] += B[bi].w; }
        Rt[n] += 1;
        for (int m = 0; m < nA; m++) {
          auto& a = A[m];
          const auto& ids = byN[m][n]; const int L = (int)ids.size();
          for (int q = 0; q < L; q++) acc[q] = 0;
          for (int z = 0; z < na; z++) { // (each acc[q] still sums over z in order)
            const int y = U[addU[z]]; const double wz = addW[z];
            if (y < 0) { for (int q = 0; q < L; q++) acc[q] += wz * in.aW[X - a.ax[ids[q]]]; }
            else { const double* cy = ca.data() + X + y; for (int q = 0; q < L; q++) acc[q] += wz * cy[-a.ax[ids[q]]]; }
          }
          for (int q = 0; q < L; q++) a.sumV[ids[q]] += acc[q];
        }
      }
      for (int m = 0; m < nA; m++) {
        auto& a = A[m]; int bi = 0; double bv = value(m, 0);
        for (int i = 1; i < (int)a.ax.size(); i++) { double v = value(m, i); if (v > bv) { bv = v; bi = i; } }
        a.cnt[bi]++; a.tot++; played[a.an[bi]] = 1;
      }
    }
  }
};
}  // namespace solver
}  // namespace kh
