// lib/bots/brain.js: what a bot may know (observe), the position model (Model) and small helpers.
#pragma once
#include <unordered_map>
#include <initializer_list>
#include "game.h"

namespace kh {

struct TrackRes; // tracker.h

// What player `me` sees (observe), plus what look() in expert.js adds.
struct Obs {
  int me = 0, n = 0; int nact = 0; int active[MAXP]; bool out[MAXP] = {false}; int herd[MAXP][NT]; int seen[NT]; double remain[NT];
  bool hasHand = true; vector<int> hand; double money[MAXP] = {0}; double pool = 0; int cards[MAXP] = {0};
  int deckLeft = 0, deckSize = 40; int mules = 0, turn = 0;
  bool hasAuction = false; int ak = 0, aA = 0; bool hasHigh = false; int highP = 0, highAmt = 0; int aStage = 0;
  bool hasTrade = false; int ta = 0, tb = 0, tk = 0, tcount = 0, toffer = -1, tties = 0; bool hasTieAt = false; double tieAt = 0;
  int viewer = -1; // whose observation this is (asSeenBy keeps it)
  const Game* g = nullptr; // khs and hist (observe hides the amounts of others' koehandels; every reader here respects that)
  // look()
  vector<int> unseen; double sd[MAXP] = {0}, sdBy[MAXP] = {0}, sdS[MAXP] = {0}, sdSBy[MAXP] = {0}, seenAs[MAXP] = {0};
  bool hasFuture = false; double future = 0; bool hasKeen = false; double keen[MAXP]; std::shared_ptr<TrackRes> track; bool trackOff[MAXP] = {false};
};

// Smaller decks: the compositions (2-4 of each type, adding up to the size) that fit what was drawn.
inline const vector<std::array<int, NT>>& compositions(int size) {
  thread_local std::unordered_map<int, vector<std::array<int, NT>>> comps;
  auto it = comps.find(size);
  if (it != comps.end()) return it->second;
  vector<std::array<int, NT>> out; std::array<int, NT> cur{};
  std::function<void(int, int)> rec = [&](int k, int left) {
    if (k == NT) { if (!left) out.push_back(cur); return; }
    for (int c = 2; c <= 4; c++) if (left - c >= 2 * (NT - k - 1) && left - c <= 4 * (NT - k - 1)) { cur[k] = c; rec(k + 1, left - c); }
  };
  rec(0, size);
  return comps[size] = out;
}
inline void expectedRemaining(int size, const int* seen, double* res) {
  thread_local std::unordered_map<long long, std::array<double, NT>> post;
  long long key = size; for (int k = 0; k < NT; k++) key = key * 8 + seen[k];
  auto it = post.find(key);
  if (it != post.end()) { for (int k = 0; k < NT; k++) res[k] = it->second[k]; return; }
  double r[NT] = {0}, W = 0;
  for (const auto& c : compositions(size)) {
    double w = 1;
    for (int k = 0; k < NT && w; k++) { if (seen[k] > c[k]) w = 0; else for (int x = 0; x < seen[k]; x++) w *= c[k] - x; }
    if (!w) continue;
    W += w; for (int k = 0; k < NT; k++) r[k] += w * (c[k] - seen[k]);
  }
  std::array<double, NT> out;
  for (int k = 0; k < NT; k++) out[k] = W ? r[k] / W : 0;
  if (post.size() > 2000) post.clear();
  post[key] = out;
  for (int k = 0; k < NT; k++) res[k] = out[k];
}

inline void observe(const Game& s, int i, Obs& o) { PROF("observe");
  o = Obs(); o.g = &s; o.me = i; o.viewer = i; o.n = s.n;
  for (int j = 0; j < s.n; j++) for (int k = 0; k < NT; k++) o.herd[j][k] = s.P[j].animals[k];
  for (int k = 0; k < NT; k++) { int n = s.hasAuction && s.au.type == k ? 1 : 0; for (int j = 0; j < s.n; j++) n += o.herd[j][k]; o.seen[k] = n; }
  o.hand = s.P[i].money; int mine = isum(o.hand);
  int pool = 0; for (int j = 0; j < s.n; j++) pool += isum(s.P[j].money);
  for (int j = 0; j < s.n; j++) {
    if (j == i) { o.money[j] = mine; continue; }
    const Player& p = s.P[j];
    if (p.out || p.money.empty()) { o.money[j] = 0; continue; }
    double e = s.ledger[j] + s.mem[i][j];
    o.money[j] = jmin(jmax(e, 0), pool - mine);
  }
  int size = s.deckSize, deckLeft = (int)s.deck.size();
  if (size >= 40) for (int k = 0; k < NT; k++) o.remain[k] = std::max(0, 4 - o.seen[k]);
  else if (!deckLeft) for (int k = 0; k < NT; k++) o.remain[k] = 0;
  else expectedRemaining(size, o.seen, o.remain);
  o.nact = 0; for (int j = 0; j < s.n; j++) { o.out[j] = s.P[j].out; if (!s.P[j].out) o.active[o.nact++] = j; o.cards[j] = (int)s.P[j].money.size(); }
  o.pool = pool; o.deckLeft = deckLeft; o.deckSize = size; o.mules = s.mules; o.turn = s.turn;
  if (s.hasAuction) { o.hasAuction = true; o.ak = s.au.type; o.aA = s.au.auctioneer; o.hasHigh = s.au.hasHigh; o.highP = s.au.highP; o.highAmt = s.au.highAmt; o.aStage = s.au.stage; }
  if (s.hasTrade) {
    const Trade& tr = s.tr; o.hasTrade = true; o.ta = tr.a; o.tb = tr.b; o.tk = tr.type; o.tcount = tr.count;
    o.toffer = tr.hasBid[tr.a] ? (int)tr.bids[tr.a].size() : -1; o.tties = tr.ties; o.hasTieAt = tr.hasTieAt; o.tieAt = tr.tieAt;
  }
}

inline double muleMoneyLeft(const Obs& o) {
  double left = o.remain[MULE], f = 0;
  for (int k = 0; k < 4 - o.mules; k++) f += MULE_PAY[o.mules + k] * jmin(1, jmax(0, left - k));
  return f;
}

struct DH { int j, k, d; };
struct DM { int j; double d; };

// A learned position model (lib/bots/value.js), its weights from agent/cpp/levels.json (NETS in lib/bots/nets.js).
// styleOf in lib/bots/value.js: per player its keenness (expert.js keenness, prior 4) and buy-back rate ((buys + 1) /
// (sales + 4)), from the public history
inline void styleOf(const vector<HistE>& hist, int n, double* keen, double* bb) {
  double lg[MAXP] = {0}, cnt[MAXP] = {0}, buys[MAXP] = {0}, sales[MAXP] = {0};
  for (const HistE& e : hist) {
    if (e.t != 'a') continue;
    if (e.p > 0) { sales[e.A]++; if (e.buy) buys[e.A]++; }
    for (int j = 0; j < n; j++) {
      if (!e.hasPred[j]) continue;
      double pr = e.pred[j];
      if (pr < 20 || e.w == j) continue;
      double r, b = e.mx[j];
      if (b) r = b / pr; else if (e.p < pr) r = jmax(0.3, (e.p ? e.p : 10) / pr); else continue;
      lg[j] += mlog(jmin(3, jmax(0.3, r))); cnt[j]++;
    }
  }
  for (int j = 0; j < n; j++) { keen[j] = mexp(lg[j] / (cnt[j] + 4)); bb[j] = (buys[j] + 1) / (sales[j] + 4); }
}
struct Net { bool style = false, rm = false; int size = 0, n = 0, ft = 0, fp = 0, E = 0, H = 0, H2 = 0; vector<double> t0w, t0b, t2w, t2b, p0w, p0b, p2w, p2b, p4w, p4b; };
inline std::map<int, Net>& NETS() { static std::map<int, Net> m; return m; }
// out = W x + b, W stored transposed ([in][out], see agents.h): each output still sums b + w0 x0 + w1 x1 + ... in that
// order, as the JS does, but the inner loop runs over the outputs, which the compiler can do several at a time
inline void ndense(const vector<double>& Wt, const vector<double>& b, int in, const double* x, double* out, bool act) {
  const int R = (int)b.size();
  for (int r = 0; r < R; r++) out[r] = b[r];
  for (int c = 0; c < in; c++) { const double xc = x[c]; const double* w = &Wt[(size_t)c * R]; for (int r = 0; r < R; r++) out[r] += w[r] * xc; }
  if (act) for (int r = 0; r < R; r++) out[r] = out[r] > 0 ? out[r] : 0;
}
class NetModel {
 public:
  const Net& net; const Obs& o; int n; bool alive[MAXP]; double c[NT], lf[NT], dl, T; int herd[MAXP][NT];
  vector<double> emb, sum, feat; // emb [player][type][E], sum [player][E], feat [player][type][ft] (arch c: the inputs)
  double m0[MAXP]; // everyone's money / 1000
  double st[MAXP][2]; // style networks: each player's log keenness and buy-back rate
  NetModel(const Obs& o_, const Net& net_, double T_) : net(net_), o(o_), n(o_.n), T(T_) {
    for (int k = 0; k < NT; k++) { c[k] = jmax(1, o.seen[k] + o.remain[k]); lf[k] = o.remain[k] / c[k]; }
    dl = o.deckSize ? (double)o.deckLeft / o.deckSize : 0;
    for (int j = 0; j < n; j++) { alive[j] = !o.out[j]; for (int k = 0; k < NT; k++) herd[j][k] = o.herd[j][k]; }
    if (net.style) { double kn[MAXP], bb[MAXP]; styleOf(o.g->hist, n, kn, bb); for (int j = 0; j < n; j++) { st[j][0] = mlog(kn[j]); st[j][1] = bb[j]; } }
    for (int j = 0; j < n; j++) m0[j] = jmax(0, o.money[j]) / 1000;
    emb.assign((size_t)n * NT * net.E, 0); sum.assign((size_t)n * net.E, 0); if (net.rm) feat.assign((size_t)n * NT * net.ft, 0);
    for (int j = 0; j < n; j++) for (int k = 0; k < NT; k++) {
      double* v = &emb[((size_t)j * NT + k) * net.E]; double f[16]; typeFeat(j, k, herd, m0, f); typeEmbF(f, v);
      if (net.rm) for (int x = 0; x < net.ft; x++) feat[((size_t)j * NT + k) * net.ft + x] = f[x];
      for (int x = 0; x < net.E; x++) sum[(size_t)j * net.E + x] += v[x];
    }
  }
  // the type network's inputs for player j and type k; money: everyone's money / 1000 (arch c)
  void typeFeat(int j, int k, const int (*hd)[NT], const double* money, double* f) const {
    const double ck = c[k]; int m1 = 0, m2 = 0;
    for (int x = 0; x < n; x++) if (x != j) { int h = hd[x][k]; if (h > m1) { m2 = m1; m1 = h; } else if (h > m2) m2 = h; }
    f[0] = hd[j][k] / ck; f[1] = m1 / ck; f[2] = m2 / ck; f[3] = lf[k]; f[4] = VAL[k] / 1000.0; f[5] = 1; f[6] = dl;
    if (net.rm) { // the other holders in order of copies, then money (then seat): the money of the first two
      int b1 = -1, b2 = -1;
      auto over = [&](int x, int y) { return y < 0 || hd[x][k] > hd[y][k] || (hd[x][k] == hd[y][k] && money[x] > money[y]); };
      for (int x = 0; x < n; x++) if (x != j) { if (over(x, b1)) { b2 = b1; b1 = x; } else if (over(x, b2)) b2 = x; }
      f[7] = money[j]; f[8] = m1 > 0 ? money[b1] : 0; f[9] = m2 > 0 ? money[b2] : 0;
    }
  }
  void typeEmbF(const double* f, double* out) const { double hx[128]; ndense(net.t0w, net.t0b, net.ft, f, hx, true); ndense(net.t2w, net.t2b, net.H, hx, out, true); }
  void typeEmb(int j, int k, const int (*hd)[NT], double* out) const { double f[16]; typeFeat(j, k, hd, m0, f); typeEmbF(f, out); }
  double util(int me, const DH* dh, int ndh, const DM* dm, int ndm) const {
    if (net.rm) return utilRM(me, dh, ndh, dm, ndm);
    const int E = net.E; int hd[MAXP][NT]; double buf[MAXP * 128]; const double* sums = sum.data();
    if (ndh) {
      for (int j = 0; j < n; j++) for (int k = 0; k < NT; k++) hd[j][k] = herd[j][k];
      for (int x = 0; x < n * E; x++) buf[x] = sum[x];
      sums = buf;
      for (int i = 0; i < ndh; i++) hd[dh[i].j][dh[i].k] = std::max(0, hd[dh[i].j][dh[i].k] + dh[i].d);
      bool done[NT] = {false}; double v[128];
      for (int i = 0; i < ndh; i++) {
        int k = dh[i].k; if (done[k]) continue; done[k] = true;
        for (int j = 0; j < n; j++) { typeEmb(j, k, hd, v); const double* old = &emb[((size_t)j * NT + k) * E]; for (int x = 0; x < E; x++) buf[(size_t)j * E + x] += v[x] - old[x]; }
      }
    }
    double money[MAXP]; for (int j = 0; j < n; j++) money[j] = o.money[j];
    for (int i = 0; i < ndm; i++) money[dm[i].j] += dm[i].d;
    return score(me, sums, money);
  }
  // arch c: every type whose inputs changed (animals, or the money of its player or of the holders it reads) is re-run
  double utilRM(int me, const DH* dh, int ndh, const DM* dm, int ndm) const {
    const int E = net.E, F = net.ft; int hd[MAXP][NT]; double buf[MAXP * 128];
    for (int j = 0; j < n; j++) for (int k = 0; k < NT; k++) hd[j][k] = herd[j][k];
    for (int i = 0; i < ndh; i++) hd[dh[i].j][dh[i].k] = std::max(0, hd[dh[i].j][dh[i].k] + dh[i].d);
    double money[MAXP]; for (int j = 0; j < n; j++) money[j] = o.money[j];
    for (int i = 0; i < ndm; i++) money[dm[i].j] += dm[i].d;
    double m[MAXP]; for (int j = 0; j < n; j++) m[j] = jmax(0, money[j]) / 1000;
    for (int x = 0; x < n * E; x++) buf[x] = sum[x];
    double f[16], v[128];
    for (int j = 0; j < n; j++) for (int k = 0; k < NT; k++) {
      typeFeat(j, k, hd, m, f); const double* f0 = &feat[((size_t)j * NT + k) * F];
      bool same = true; for (int x = 0; x < F; x++) if (f[x] != f0[x]) { same = false; break; }
      if (same) continue;
      typeEmbF(f, v); const double* old = &emb[((size_t)j * NT + k) * E];
      for (int x = 0; x < E; x++) buf[(size_t)j * E + x] += v[x] - old[x];
    }
    return score(me, buf, money);
  }
  // the player network on the summed type embeddings and the money: player me's chance to win
  unsigned ally = 0; double allyW = 1; // th.gang: the seats whose chances count as mine (times allyW) when me is one of them
  double score(int me, const double* sums, const double* money) const {
    const int E = net.E;
    double z[MAXP], mx = -INF, p[256], h1[256], h2[256], zo[1];
    for (int j = 0; j < n; j++) {
      if (!alive[j]) continue;
      for (int x = 0; x < E; x++) p[x] = sums[(size_t)j * E + x];
      int q = E; p[q++] = jmax(0, money[j]) / 1000;
      std::pair<double, int> om[MAXP]; int no = 0; for (int x = 0; x < n; x++) if (x != j) om[no++] = {jmax(0, money[x]) / 1000, x};
      std::stable_sort(om, om + no, [](const std::pair<double, int>& a, const std::pair<double, int>& b) { return a.first > b.first; });
      for (int x = 0; x < no; x++) p[q++] = om[x].first;
      p[q++] = o.cards[j] / 20.0; p[q++] = dl; p[q++] = o.mules / 4.0; p[q++] = o.turn == j ? 1 : 0; p[q++] = (o.deckSize ? o.deckSize : 40) / 40.0;
      if (net.style) { p[q++] = st[j][0]; p[q++] = st[j][1]; for (int x = 0; x < no; x++) { p[q++] = st[om[x].second][0]; p[q++] = st[om[x].second][1]; } }
      ndense(net.p0w, net.p0b, E + net.fp, p, h1, true); ndense(net.p2w, net.p2b, net.H2, h1, h2, true); ndense(net.p4w, net.p4b, net.H2, h2, zo, false);
      z[j] = zo[0] / T; if (z[j] > mx) mx = z[j];
    }
    double tot = 0, mine = 0;
    const unsigned us = (ally >> me) & 1 ? ally : 1u << me;
    for (int j = 0; j < n; j++) if (alive[j]) { double e = mexp(z[j] - mx); tot += e; if (j == me) mine += e; else if ((us >> j) & 1) mine += allyW * e; }
    return mine / tot;
  }
};

// The position model (brain.js Model).
class Model {
 public:
  double mix = 1; std::shared_ptr<NetModel> nm; // th.net: the learned model instead of this formula, where a network for this table exists
  int n; double gamma, delta, mu, tau, tau1, own; bool hasOwn; unsigned ally = 0; double allyW = 1;
  unsigned char alive[MAXP]; double money[MAXP], herd[MAXP * NT], share[NT], powTab[NT * 6], bp[MAXP * NT], mf0[MAXP];
  vector<double> mfTab;
  Model(const Obs& o, const Th& th) { PROF("Model");
    if (th.t(T_net)) { auto it = NETS().find((int)jround(th[T_net])); if (it != NETS().end() && it->second.n == o.n && (!it->second.size || it->second.size == o.deckSize)) nm = std::make_shared<NetModel>(o, it->second, th.t(T_netT) ? th[T_netT] : 1); }
    if (th.h(T_netMix)) mix = th[T_netMix];
    if (th.t(T_gang) && o.g) { for (int j = 0; j < o.n; j++) if (o.g->gang[j]) ally |= 1u << j; allyW = jmin(1, th[T_gang]); }
    // paranoid (prototype): the others are predicted as if they played together against me (a gang of weight paranoid)
    if (th.t(T_paranoid) && o.viewer >= 0) { for (int j = 0; j < o.n; j++) if (j != o.viewer) ally |= 1u << j; allyW = jmin(1, th[T_paranoid]); }
    if (nm) { nm->ally = ally; nm->allyW = allyW; }
    n = o.n; int m = std::max(1, o.nact);
    gamma = th[T_gamma]; delta = th[T_delta];
    mu = th[T_mu] + th.z(T_kappa) * (o.hasFuture ? (truthy(o.future) ? o.future : 0) : 0);
    if (th.t(T_muScale)) mu *= (o.pool / m + muleMoneyLeft(o)) / 940;
    double left = o.deckSize ? (double)o.deckLeft / o.deckSize : 1;
    if (th.h(T_muEnd)) mu *= th[T_muEnd] + (1 - th[T_muEnd]) * left;
    if (th.h(T_deltaEnd)) {
      double de = th[T_deltaEnd];
      // deltaPoor (prototype): the end value of the money exponent when poorer than the richest other (by poorM or more;
      // in between a straight line): money decides the endgame fights, so it is worth more while behind
      if (th.h(T_deltaPoor)) { double mx = 0; for (int j = 0; j < o.n; j++) if (j != o.me && !o.out[j]) mx = jmax(mx, o.money[j]);
        double w = jmin(1, jmax(0, (mx - o.money[o.me]) / (th.h(T_poorM) ? th[T_poorM] : 300))); de += w * (th[T_deltaPoor] - de); }
      delta = de + (th[T_delta] - de) * left;
    }
    tau = th[T_tau]; tau1 = th[T_tau1]; hasOwn = th.t(T_own); own = th[T_own];
    for (int j = 0; j < n; j++) { alive[j] = o.out[j] ? 0 : 1; money[j] = jmax(0, o.money[j]); }
    for (int k = 0; k < NT; k++) {
      double limbo = 0; for (int j = 0; j < n; j++) if (o.out[j]) limbo += o.herd[j][k];
      share[k] = th[T_rho] * (o.remain[k] + limbo) / m;
    }
    for (int k = 0; k < NT; k++) for (int h = 0; h < 6; h++) { double b = h + share[k]; powTab[k * 6 + h] = b > 0 ? mpow(b, th[T_gamma]) : 0; }
    mfTab.assign((size_t)std::ceil(o.pool / 10) + 2, -1);
    for (int j = 0; j < n * NT; j++) { herd[j] = 0; bp[j] = 0; }
    for (int j = 0; j < n; j++) {
      mf0[j] = 0;
      if (!alive[j]) continue;
      for (int k = 0; k < NT; k++) { herd[j * NT + k] = o.herd[j][k]; bp[j * NT + k] = pw(o.herd[j][k], k); }
      mf0[j] = mfOf(money[j]);
    }
  }
  double pw(double h, int k) const { return powTab[k * 6 + (h > 5 ? 5 : (int)h)]; }
  double mfOf(double m) {
    double i = m > 0 ? jround(m / 10) : 0;
    if (i >= (double)mfTab.size()) return mpow(i * 10 + mu, delta);
    double& t = mfTab[(size_t)i];
    return t >= 0 ? t : (t = mpow(i * 10 + mu, delta));
  }
  double util(int me, std::initializer_list<DH> dhl, std::initializer_list<DM> dml) { return util(me, dhl.begin(), (int)dhl.size(), dml.begin(), (int)dml.size()); }
  double util(int me, const DH* dh, int ndh, const DM* dm, int ndm) {
    if (!nm) return formula(me, dh, ndh, dm, ndm);
    double u = nm->util(me, dh, ndh, dm, ndm);
    return mix >= 1 ? u : mix * u + (1 - mix) * formula(me, dh, ndh, dm, ndm);
  }
  double formula(int me, const DH* dh, int ndh, const DM* dm, int ndm) {
    double mf[MAXP], E[MAXP], A[MAXP], B[MAXP], C[MAXP], sv[8];
    for (int j = 0; j < n; j++) mf[j] = mf0[j];
    for (int i = 0; i < ndm; i++) {
      int j = dm[i].j; if (!alive[j]) continue;
      double m = money[j]; for (int x = 0; x < ndm; x++) if (dm[x].j == j) m += dm[x].d;
      mf[j] = mfOf(m);
    }
    for (int i = 0; i < ndh; i++) {
      int j = dh[i].j, k = dh[i].k; double h = herd[j * NT + k] + dh[i].d;
      sv[i] = bp[j * NT + k];
      bp[j * NT + k] = alive[j] ? pw(h > 0 ? h : 0, k) : 0;
    }
    for (int j = 0; j < n; j++) { A[j] = 0; B[j] = 0; C[j] = 0; }
    for (int k = 0; k < NT; k++) {
      double tot = 0; for (int j = 0; j < n; j++) tot += bp[j * NT + k] * mf[j];
      if (tot <= 0) continue;
      double v = VAL[k], inv = 1 / tot;
      for (int j = 0; j < n; j++) { double p = bp[j * NT + k] * mf[j] * inv; A[j] += p * v; B[j] += p; C[j] += p * p * v; }
    }
    for (int i = ndh - 1; i >= 0; i--) bp[dh[i].j * NT + dh[i].k] = sv[i];
    double mean = 0, mx = -INF; int cnt = 0;
    for (int j = 0; j < n; j++) if (alive[j]) { double e = A[j] * B[j] - C[j] + A[j]; E[j] = e; mean += e; cnt++; if (e > mx) mx = e; }
    double itau = 1 / (tau * (mean / (cnt ? cnt : 1) + tau1));
    double z = 0, mine = 0;
    const unsigned us = (ally >> me) & 1 ? ally : 1u << me;
    for (int j = 0; j < n; j++) if (alive[j]) { double e = mexp((E[j] - mx) * itau); z += e; if (j == me) mine += e; else if ((us >> j) & 1) mine += allyW * e; }
    if (hasOwn) return mine / z + own * jmax(0, E[me]) / jmax(1e-9, mean);
    return mine / z;
  }
};

// Every amount (multiple of 10) some subset of the hand adds up to, ascending.
inline vector<int> sums(const vector<int>& hand) {
  int tot = isum(hand) / 10; vector<unsigned char> can(tot + 1, 0); can[0] = 1;
  for (int c : hand) { int d = c / 10; if (d) for (int v = tot; v >= d; v--) if (can[v - d]) can[v] = 1; }
  vector<int> out; for (int v = 0; v <= tot; v++) if (can[v]) out.push_back(v * 10);
  return out;
}
struct Tgt { int p, k, count; };
inline vector<Tgt> targetsOf(const Obs& o) {
  vector<Tgt> out; int me = o.me;
  if (o.out[me]) return out;
  for (int j = 0; j < o.n; j++) if (j != me) for (int k = 0; k < NT; k++) { int a = o.herd[me][k], b = o.herd[j][k]; if (a && b) out.push_back({j, k, std::min(a, b)}); }
  return out;
}
inline int repeats(const Obs& o, int a, int b, int k) {
  int c = 0; for (const auto& e : o.g->khs) if (e[2] == k && ((e[0] == a && e[1] == b) || (e[0] == b && e[1] == a))) c++;
  return c;
}
inline int settling(const Obs& o, int me, int j, int k) { return repeats(o, me, j, k) >= 2 ? (int)sgn(o.herd[me][k] - o.herd[j][k]) : 0; }
}  // namespace kh
