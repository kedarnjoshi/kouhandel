// Shared basics of the C++ simulator: JS number helpers, the random number generator, the rules, bot settings.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include "jsmath.h"

namespace kh {
using std::vector;
const double INF = std::numeric_limits<double>::infinity();
const double NaN = std::numeric_limits<double>::quiet_NaN();

// Transcendental math: -DKH_EXACT_MATH uses ports of V8's own routines (bit for bit the same results as node, for
// checking the port move for move); the default build uses the C library (last-bit differences, so games drift
// apart from the JS ones over time, statistically the same).
#ifdef KH_EXACT_MATH
inline double mexp(double x) { return js::exp(x); }
inline double mlog(double x) { return js::log(x); }
inline double mpow(double x, double y) { return js::pow(x, y); }
inline double mcos(double x) { return js::cos_fdlibm(x); }
#else
inline double mexp(double x) { return std::exp(x); }
inline double mlog(double x) { return std::log(x); }
inline double mpow(double x, double y) { return std::pow(x, y); }
inline double mcos(double x) { return std::cos(x); }
#endif
// -DKH_PROF: time spent per function (agent/cpp/gamespeed prints it)
#ifdef KH_PROF
#include <chrono>
#include <map>
struct ProfAcc { double t = 0; long long n = 0; };
inline std::map<std::string, ProfAcc>& profTab() { static std::map<std::string, ProfAcc> m; return m; }
struct ProfScope { ProfAcc* a; std::chrono::steady_clock::time_point t0; explicit ProfScope(const char* nm) : a(&profTab()[nm]), t0(std::chrono::steady_clock::now()) {}
  ~ProfScope() { a->t += std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(); a->n++; } };
#define PROF(nm) ProfScope prof_scope_(nm)
#else
#define PROF(nm)
#endif
// JS semantics
inline double jround(double x) { double r = std::ceil(x); if (r - 0.5 > x) r -= 1.0; return r; } // Math.round
inline double jmax(double a, double b) { if (a != a || b != b) return NaN; if (a > b) return a; if (b > a) return b; return (a == 0 && std::signbit(a)) ? b : a; }
inline double jmin(double a, double b) { if (a != a || b != b) return NaN; if (a < b) return a; if (b < a) return b; return (a == 0 && std::signbit(a)) ? a : b; }
inline double tens(double x) { return jmax(0, std::floor(x / 10) * 10); }
inline double clampd(double x, double a, double b) { return jmin(b, jmax(a, x)); }
inline bool truthy(double x) { return x != 0 && x == x; }
inline double sgn(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; } // Math.sign
inline int isum(const vector<int>& a) { int s = 0; for (int x : a) s += x; return s; }
// a value JS would have thrown on (TypeError etc.): the simulator counts it as a bot error, as playOut does
struct JsThrow { const char* what; };

// The random numbers of lib/bots/sim.js (rng) and the trackers (mulberry): the same generator.
struct Rng {
  int32_t seed; long long calls = 0;
  explicit Rng(uint32_t s = 0) : seed((int32_t)s) {}
  double operator()() {
    calls++;
    uint32_t sd = (uint32_t)seed + 0x6D2B79F5u; seed = (int32_t)sd;
    uint32_t t = (sd ^ (sd >> 15)) * (1u | sd);
    t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
};

// rules
const int NT = 10, MAXP = 6;
const int VAL[NT] = {1000, 800, 650, 500, 350, 250, 160, 90, 40, 10};
const char* const TYPES[NT] = {"horse", "cow", "pig", "mule", "goat", "sheep", "dog", "cat", "duck", "chicken"};
const int START_MONEY[7] = {0, 0, 10, 10, 10, 10, 50};
const int MULE_PAY[4] = {50, 100, 200, 500};
const int MULE = 3;
inline int typeIndex(const std::string& t) { for (int k = 0; k < NT; k++) if (t == TYPES[k]) return k; return -1; }

// Cards worth at least amt with the least overpayment (then the fewest cards): rules.js cheapest, with its Map
// (insertion order, values replaced in place) and the snapshot it iterates per card.
inline vector<int> cheapest(const vector<int>& hand, double amt) { PROF("cheapest");
  // persistent lists: node = (parent, card, length)
  thread_local vector<int> par, card, len; thread_local vector<int> keys, node, pos; thread_local vector<std::pair<int, int>> snap;
  par.clear(); card.clear(); len.clear(); keys.clear(); node.clear();
  int tot = 0; for (int c : hand) tot += c;
  pos.assign(tot / 10 + 2, -1);
  par.push_back(-1); card.push_back(0); len.push_back(0);
  keys.push_back(0); node.push_back(0); pos[0] = 0;
  for (int c : hand) {
    snap.assign(keys.size(), {0, 0});
    for (size_t e = 0; e < keys.size(); e++) snap[e] = {keys[e], node[e]};
    for (auto& [v, cs] : snap) {
      int key = v + c, at = pos[key / 10];
      if (at < 0 || len[node[at]] > len[cs] + 1) {
        par.push_back(cs); card.push_back(c); len.push_back(len[cs] + 1);
        int nd = (int)par.size() - 1;
        if (at < 0) { pos[key / 10] = (int)keys.size(); keys.push_back(key); node.push_back(nd); } else node[at] = nd;
      }
    }
  }
  int pick = -1;
  for (size_t e = 0; e < keys.size(); e++) if (keys[e] >= amt && (pick < 0 || keys[e] < keys[pick])) pick = (int)e;
  if (pick < 0) return hand;
  vector<int> out(len[node[pick]]);
  for (int nd = node[pick], x = (int)out.size() - 1; nd > 0; nd = par[nd], x--) out[x] = card[nd];
  return out;
}

// ------------------------------------------------------------------------------------------------------------
// Bot settings (th): named numbers, each possibly absent (JS undefined), plus th.small (the 20-card values).
enum ThKey {
  T_rho, T_gamma, T_delta, T_mu, T_tau, T_tau1, T_eps, T_mBid, T_shade, T_mDec, T_aucM, T_khBias, T_pc, T_gap, T_pad, T_phi, T_mResp,
  T_kappa, T_muScale, T_muEnd, T_deltaEnd, T_own, T_naive, T_style, T_solve, T_solveK, T_solveIt, T_solveEps, T_solvePad, T_habits,
  T_habitsA, T_open, T_openHist, T_openT, T_softCap, T_sharp, T_padCost, T_allIn, T_track, T_trackHands, T_roughK, T_roughIt, T_mDecP,
  T_adapt, T_shadeK, T_net, T_netT, T_netMix, T_habitsAll, T_acceptP, T_boldP, T_person, T_khBiasP, NK
};
const char* const THN[NK] = {"rho", "gamma", "delta", "mu", "tau", "tau1", "eps", "mBid", "shade", "mDec", "aucM", "khBias", "pc", "gap",
                             "pad", "phi", "mResp", "kappa", "muScale", "muEnd", "deltaEnd", "own", "naive", "style", "solve", "solveK",
                             "solveIt", "solveEps", "solvePad", "habits", "habitsA", "open", "openHist", "openT", "softCap", "sharp",
                             "padCost", "allIn", "track", "trackHands", "roughK", "roughIt", "mDecP", "adapt", "shadeK", "net", "netT", "netMix", "habitsAll", "acceptP", "boldP", "person", "khBiasP"};
inline int thKey(const std::string& s) { for (int k = 0; k < NK; k++) if (s == THN[k]) return k; return -1; }
struct Th {
  double v[NK]; uint64_t has = 0; std::shared_ptr<Th> small, solo; // solo: the settings when all the others are people
  Th() { for (auto& x : v) x = NaN; }
  bool h(int k) const { return (has >> k) & 1; }
  double operator[](int k) const { return h(k) ? v[k] : NaN; } // undefined in arithmetic: NaN
  bool t(int k) const { return h(k) && truthy(v[k]); }          // if (th.k)
  double z(int k) const { return t(k) ? v[k] : 0; }             // th.k || 0
  double d(int k, double def) const { return h(k) ? v[k] : def; } // th.k ?? def
  double o(int k, double def) const { return t(k) ? v[k] : def; } // th.k || def
  void set(int k, double x) { v[k] = x; has |= 1ull << k; }
  void merge(const Th& o) { for (int k = 0; k < NK; k++) if (o.h(k)) set(k, o.v[k]); if (o.small) small = o.small; if (o.solo) solo = o.solo; } // {...this, ...o}
};
inline Th DEFAULTS() {
  Th t; const double d[] = {1, 1.6, 0.35, 30, 0.35, 50, 0.3, 0.0, 1, 0.0, 1, 0, 0.7, 20, 0.3, 1.3, 0.0};
  for (int k = 0; k <= T_mResp; k++) t.set(k, d[k]);
  return t;
}
inline Th EXPERT() {
  Th t; t.set(T_tau, 1.432); t.set(T_tau1, 68.93); t.set(T_rho, 1.289); t.set(T_gamma, 1.106); t.set(T_delta, 0.8568); t.set(T_mu, 508.3); t.set(T_mDec, 0.02);
  return t;
}
}  // namespace kh
