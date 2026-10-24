// The koehandel solver of lib/bots/solver.js (solve), ported line for line: the same arithmetic in the same order,
// so the results are bit for bit the same. Build without fast-math or FMA contraction (they reorder the sums):
//   g++ -O3 -march=native -ffp-contract=off -o solve agent/cpp/solve.cpp
// As a program it checks and times the kernel on cases saved from real games (agent/cpp/dump_solve.mjs):
//   ./solve agent/cpp/solve_cases.txt [repeats]
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <vector>
#include <algorithm>
#include <utility>

namespace kh {
using std::vector;
const int NEG = -1;

// reach[v] = bitmask of card counts that make v*10
static vector<uint32_t> reachable(const vector<int>& hand) {
  int tot = 0; for (int c : hand) tot += c; tot /= 10;
  vector<uint32_t> reach(tot + 1, 0); reach[0] = 1;
  for (int c : hand) { int d = c / 10; for (int v = tot; v >= d; v--) if (reach[v - d]) reach[v] |= reach[v - d] << 1; }
  return reach;
}
// every step up to fine, then about ratio apart, and the maximum
static vector<int> grid(const vector<int>& vals, int fine = 20, double ratio = 1.1) {
  vector<int> out;
  for (size_t i = 0; i < vals.size(); i++) { int v = vals[i]; if (v <= fine || out.empty() || v >= out.back() * ratio || v == vals.back()) out.push_back(v); }
  return out;
}
// "any n cards of this hand are equally likely": per n, (x, p) pairs; empty = none
static vector<vector<std::pair<int, double>>> anyBelief(const vector<int>& hand, int maxN) {
  int C = std::min((int)hand.size(), maxN), V = 0; for (int c : hand) V += c; V /= 10;
  vector<vector<double>> dp(C + 1, vector<double>(V + 1, 0.0)); dp[0][0] = 1;
  int top = 0;
  for (int c : hand) { int d = c / 10; for (int n = C - 1; n >= 0; n--) { auto& row = dp[n]; auto& nxt = dp[n + 1]; for (int v = top; v >= 0; v--) if (row[v]) nxt[v + d] += row[v]; } top += d; }
  vector<vector<std::pair<int, double>>> out(C + 1);
  for (int n = 0; n <= C; n++) { double tot = 0; for (double x : dp[n]) tot += x; if (tot) for (int v = 0; v <= V; v++) if (dp[n][v]) out[n].push_back({v, dp[n][v] / tot}); }
  return out;
}

struct Type { vector<int> hand; double w; };
using Dist = vector<vector<std::pair<int, double>>>; // per n: (amount or answer, p)
struct Input {
  int X; bool ties; int floor, iters; double eps; int maxN, maxPad; double habitW, answersW;
  vector<Type> aT, bT; vector<double> aW, aL, bW, bL; Dist habit, answers;
};
struct AType { double w; vector<int> ax, an; vector<double> cnt, sumV; double tot; vector<vector<std::pair<int, double>>> anyN; };
struct Result { vector<AType> A; };

Result solve(const Input& in) {
  const int X = in.X;
  const double* aW = in.aW.data(); const double* aL = in.aL.data(); const double* bW = in.bW.data(); const double* bL = in.bL.data();
  const double aTie = in.ties ? aW[X] : 0.5 * (aW[X] + aL[X]), bTie = in.ties ? bL[X] : 0.5 * (bW[X] + bL[X]);
  auto vA = [&](int x, int y) { return y < 0 ? aW[X - x] : y > x ? aL[X + y - x] : y < x ? aW[X + y - x] : aTie; };
  auto vB = [&](int x, int y) { return y < 0 ? bL[X + x] : y > x ? bW[X + x - y] : y < x ? bL[X + x - y] : bTie; };
  int N = 0;
  Result res; auto& A = res.A;
  for (const auto& t : in.aT) {
    auto r = reachable(t.hand); vector<int> xs; for (int v = 0; v < (int)r.size(); v++) if (r[v]) xs.push_back(v);
    AType a; a.w = t.w;
    int hn = (int)t.hand.size();
    for (int x : grid(xs)) {
      if (x * 10 < in.floor) continue;
      int kept = 0;
      for (int n = 0; n <= std::min(in.maxN, hn) && kept < in.maxPad; n++) if ((r[x] >> n) & 1) { a.ax.push_back(x); a.an.push_back(n); kept++; if (n > N) N = n; }
    }
    if (a.ax.empty()) { int n = std::min(in.maxN, hn); a.ax.push_back(xs.back()); a.an.push_back(n); if (n > N) N = n; }
    a.cnt.assign(a.ax.size(), 1.0 / a.ax.size()); a.tot = 1; a.anyN = anyBelief(t.hand, in.maxN); a.sumV.assign(a.ax.size(), 0.0);
    A.push_back(std::move(a));
  }
  // defender answers on a shared grid
  vector<int> U{NEG}; vector<int> uOf(X + 2, -1); // uOf[y] for y >= 1 (NEG is index 0)
  struct BType { double w; vector<int> idx; };
  vector<BType> B;
  for (const auto& t : in.bT) {
    auto r = reachable(t.hand); vector<int> ys; for (int v = 1; v < (int)r.size(); v++) if (r[v]) ys.push_back(v);
    BType b; b.w = t.w; b.idx.push_back(0);
    for (int y : grid(ys)) { if (uOf[y] < 0) { uOf[y] = (int)U.size(); U.push_back(y); } b.idx.push_back(uOf[y]); }
    B.push_back(std::move(b));
  }
  const int nA = (int)A.size(), nB = (int)B.size(), nU = (int)U.size();
  vector<vector<vector<int>>> byN(nA, vector<vector<int>>(N + 1));
  for (int m = 0; m < nA; m++) for (int i = 0; i < (int)A[m].ax.size(); i++) byN[m][A[m].an[i]].push_back(i);
  vector<int> all(X + 1); for (int v = 0; v <= X; v++) all[v] = v;
  vector<int> G = grid(all); const int nG = (int)G.size();
  vector<int> snap(X + 1);
  for (int v = 0, gi = 0; v <= X; v++) { while (gi + 1 < nG && G[gi + 1] <= v) gi++; snap[v] = gi; }
  vector<vector<double>> anyP(N + 1, vector<double>(nG, 0.0)), anyX(N + 1, vector<double>(nG, 0.0));
  for (const auto& a : A) for (int n = 0; n <= N; n++) {
    if (n >= (int)a.anyN.size() || a.anyN[n].empty()) continue;
    for (auto [x, p] : a.anyN[n]) if (x * 10 >= in.floor) { anyP[n][snap[x]] += a.w * in.eps * p; anyX[n][snap[x]] += a.w * in.eps * p * x; }
  }
  if (in.habitW > 0) for (int n = 0; n <= N; n++) for (auto [x0, p] : in.habit[n]) {
    int x = std::min(X, std::max((int)std::ceil(in.floor / 10.0), x0)); anyP[n][snap[x]] += in.habitW * p; anyX[n][snap[x]] += in.habitW * p * x;
  }
  vector<double> px(nG), pxx(nG), postX(nG), postP(nG); int postLen = 0;
  auto post = [&](int n) {
    if (n <= N) { std::copy(anyP[n].begin(), anyP[n].end(), px.begin()); std::copy(anyX[n].begin(), anyX[n].end(), pxx.begin()); }
    else { std::fill(px.begin(), px.end(), 0.0); std::fill(pxx.begin(), pxx.end(), 0.0); }
    if (n <= N) for (int m = 0; m < nA; m++) {
      const auto& a = A[m]; const double f = a.w * (1 - in.eps) / a.tot; const auto& ids = byN[m][n];
      for (int i : ids) { int x = a.ax[i], g = snap[x]; double c = f * a.cnt[i]; px[g] += c; pxx[g] += c * x; }
    }
    double tot = 0; for (int g = 0; g < nG; g++) tot += px[g];
    postLen = 0;
    if (!tot) { postX[0] = std::min((double)X, std::max(in.floor / 10.0, n * 2.0)); postP[0] = 1; postLen = 1; return; }
    for (int g = 0; g < nG; g++) if (px[g] > 0) { postX[postLen] = std::round(pxx[g] / px[g]); postP[postLen++] = px[g] / tot; }
  };
  vector<double> E(nU), Rt(N + 1, 0.0);
  auto value = [&](int m, int i) {
    const auto& a = A[m]; int n = a.an[i];
    double v = Rt[n] ? a.sumV[i] / Rt[n] : 0;
    if (in.answersW > 0) { double h = 0; for (auto [y, p] : in.answers[n]) h += p * vA(a.ax[i], y < 0 ? NEG : std::min(X, y)); v = (1 - in.answersW) * v + in.answersW * h; }
    return v;
  };
  vector<vector<int>> last(N + 1, vector<int>(nB, 0)); vector<char> seen(N + 1, 0), played(N + 1, 0);
  vector<int> addU(nB); vector<double> addW(nB);
  for (int it = 1; it <= in.iters; it++) {
    for (int n = 0; n <= N; n++) {
      auto& ln = last[n];
      if (played[n] || !seen[n]) {
        post(n);
        for (int u = 0; u < nU; u++) { int y = U[u]; double v = 0; for (int i = 0; i < postLen; i++) v += postP[i] * vB((int)postX[i], y); E[u] = v; }
        seen[n] = 1;
        for (int bi = 0; bi < nB; bi++) { const auto& idx = B[bi].idx; int best = idx[0]; for (int u : idx) if (E[u] > E[best] + 1e-12) best = u; ln[bi] = best; }
      }
      int na = 0;
      for (int bi = 0; bi < nB; bi++) { int u = ln[bi], z = 0; while (z < na && addU[z] != u) z++; if (z == na) { addU[na] = u; addW[na++] = B[bi].w; } else addW[z] += B[bi].w; }
      Rt[n] += 1;
      for (int m = 0; m < nA; m++) {
        auto& a = A[m]; const auto& ids = byN[m][n];
        for (int i : ids) { int x = a.ax[i]; double v = 0; for (int z = 0; z < na; z++) v += addW[z] * vA(x, U[addU[z]]); a.sumV[i] += v; }
      }
    }
    for (int m = 0; m < nA; m++) {
      auto& a = A[m]; int bi = 0; double bv = value(m, 0);
      for (int i = 1; i < (int)a.ax.size(); i++) { double v = value(m, i); if (v > bv) { bv = v; bi = i; } }
      a.cnt[bi]++; a.tot++; played[a.an[bi]] = 1;
    }
  }
  return res;
}
} // namespace kh

#ifndef KH_NO_MAIN
// --- check and time on saved cases ---
static char* P;
static double rd() { char* e; double v = strtod(P, &e); P = e; return v; }
static int ri() { return (int)rd(); }
int main(int argc, char** argv) {
  using namespace kh;
  FILE* f = fopen(argv[1], "rb"); if (!f) { fprintf(stderr, "cannot open %s\n", argv[1]); return 1; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  std::vector<char> buf(sz + 1); fread(buf.data(), 1, sz, f); buf[sz] = 0; fclose(f); P = buf.data();
  int reps = argc > 2 ? atoi(argv[2]) : 20, cases = ri();
  std::vector<Input> ins(cases); std::vector<std::vector<std::vector<double>>> want(cases);
  for (int c = 0; c < cases; c++) {
    Input& in = ins[c];
    in.X = ri(); in.ties = ri(); in.floor = ri(); in.iters = ri(); in.eps = rd(); in.maxN = ri(); in.maxPad = ri(); in.habitW = rd(); in.answersW = rd();
    for (auto* T : {&in.aT, &in.bT}) { int k = ri(); for (int i = 0; i < k; i++) { Type t; t.w = rd(); int L = ri(); for (int j = 0; j < L; j++) t.hand.push_back(ri()); T->push_back(t); } }
    for (auto* t : {&in.aW, &in.aL, &in.bW, &in.bL}) { t->resize(2 * in.X + 1); for (auto& v : *t) v = rd(); }
    for (auto* d : {&in.habit, &in.answers}) { d->resize(in.maxN + 1); for (int n = 0; n <= in.maxN; n++) { int k = ri(); for (int i = 0; i < k; i++) { int x = ri(); double p = rd(); (*d)[n].push_back({x, p}); } } }
    for (size_t m = 0; m < in.aT.size(); m++) { int L = ri(); std::vector<double> w(L); for (auto& v : w) v = rd(); want[c].push_back(w); }
  }
  int bad = 0;
  for (int c = 0; c < cases; c++) {
    Result r = solve(ins[c]);
    for (size_t m = 0; m < r.A.size(); m++) if (r.A[m].cnt != want[c][m]) { if (bad < 3) fprintf(stderr, "case %d type %zu differs\n", c, m); bad++; break; }
  }
  auto t0 = std::chrono::steady_clock::now();
  double sink = 0;
  for (int k = 0; k < reps; k++) for (int c = 0; c < cases; c++) { Result r = solve(ins[c]); sink += r.A[0].cnt[0]; }
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("%d cases, %d differ from JS; %.3f ms per solve (%g)\n", cases, bad, ms / reps / cases, sink > 0 ? 0.0 : 1.0);
  return bad ? 2 : 0;
}
#endif
