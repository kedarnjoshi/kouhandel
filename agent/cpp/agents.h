// The experiment opponents (agent/scripts/shark.mjs, novice.mjs, exploiters.mjs) and the registry of agents by
// name (agent/scripts/registry.mjs): levels, named specs (agent/runs/specs2.json), overrides like insane:shade=1.2.
#pragma once
#include <fstream>
#include <map>
#include <sstream>
#include "expert.h"

namespace kh {
#ifdef _WIN32
const char* const NULLDEV = "NUL";
#else
const char* const NULLDEV = "/dev/null";
#endif

// ---- shark
inline double sharkWorth(const Obs& o, int j, int k) {
  static const double W[4] = {0.22, 0.32, 0.5, 0.9};
  int h = o.herd[j][k]; double others = 0; for (int x = 0; x < o.nact; x++) if (o.active[x] != j) others = others + o.herd[o.active[x]][k];
  double a = 0; for (int x = 0; x < o.nact; x++) a = a + o.money[o.active[x]];
  double avg = a / o.nact, infl = jmin(2.5, jmax(0.35, (avg + 150) / 450));
  return VAL[k] * W[std::min(3, h)] * infl * (others >= 3 ? 0.6 : 1);
}
inline int sharkExposed(const Obs& o, int j) {
  int c = 0;
  for (int k = 0; k < NT; k++) { if (!o.herd[j][k]) continue; bool any = false; for (int x = 0; x < o.nact; x++) if (o.active[x] != j && o.herd[o.active[x]][k]) any = true; c += any; }
  return c;
}
class Shark : public Agent {
 public:
  double cap(Game& s, int i, Rng&) override {
    Obs o; observe(s, i, o); int k = o.ak; double m = o.money[i];
    double reserve = o.deckLeft > 4 ? jmin(m * 0.35, 40.0 * sharkExposed(o, i)) : 0;
    return jmax(jmin(10, m), tens(jmin(m - reserve, sharkWorth(o, i, k))));
  }
  Move act(Game& s, int i, int what, Rng& rand) override {
    Obs o; observe(s, i, o); int me = i; double m = o.money[i];
    if (what == W_PAY) return mvCards(MV_PAY, cheapest(o.hand, s.au.highAmt));
    if (what == W_DECIDE) { double p = o.highAmt; return mvType(m >= p && o.herd[me][o.ak] >= 1 && p < sharkWorth(o, me, o.ak) * 1.1 ? MV_BUY : MV_SELL); }
    if (what == W_TURN) {
      struct T { int p, k, count; double val, cost; };
      vector<T> ts;
      for (const Tgt& t : targetsOf(o)) ts.push_back({t.p, t.k, t.count, sharkWorth(o, me, t.k) * t.count + sharkWorth(o, t.p, t.k) * t.count * 0.5, o.out[t.p] ? 0 : o.money[t.p] + 10});
      auto cmp = [](const T& a, const T& b) { return b.val - b.cost - (a.val - a.cost) < 0; };
      vector<T> cheap; for (auto& t : ts) if (t.cost <= jmin(m, 40) || (t.cost < t.val * 0.7 && t.cost <= m * 0.6)) cheap.push_back(t);
      std::stable_sort(cheap.begin(), cheap.end(), cmp);
      Move mv; mv.type = MV_KOEHANDEL;
      if (cheap.size() && (!o.deckLeft || cheap[0].val > 30)) { mv.target = cheap[0].p; mv.animal = cheap[0].k; return mv; }
      if (o.deckLeft) return mvType(MV_AUCTION);
      std::stable_sort(ts.begin(), ts.end(), cmp);
      if (ts.empty()) throw JsThrow{"TypeError: t is undefined"};
      mv.target = ts[0].p; mv.animal = ts[0].k; return mv;
    }
    if (what == W_OFFER) {
      double mb = o.money[o.tb], val = sharkWorth(o, me, o.tk) * o.tcount * 1.6;
      double x = mb + 10 <= jmin(m, jmax(val, 60)) ? mb + 10 : tens(jmin(m, val) * (0.5 + 0.3 * rand()));
      if (mb <= 0) x = 0;
      vector<int> cards = truthy(x) ? cheapest(o.hand, x) : vector<int>();
      int zeros = 0; for (int c : o.hand) zeros += c == 0; for (int c : cards) zeros -= c == 0;
      if (zeros && rand() < 0.5) cards.push_back(0);
      return mvCards(MV_TRADEBID, cards);
    }
    int a = o.ta, n = o.toffer; double avg = o.money[a] / std::max(1, o.cards[a]);
    double guess = jmin(o.money[a], n * avg), val = sharkWorth(o, me, o.tk) * o.tcount * 1.8 + sharkWorth(o, a, o.tk) * o.tcount * 0.6;
    double y = tens(guess) + 10;
    if (y <= m && y < val) return mvCards(MV_TRADEBID, cheapest(o.hand, y));
    return mvType(MV_ACCEPT);
  }
};

// ---- novice
class Novice : public Agent {
 public:
  static double noise(Rng& rand, double sd) { double a = rand(); a = a + rand(); a = a + rand(); return mexp(sd * (a - 1.5) * 1.4); }
  double cap(Game& s, int i, Rng& rand) override {
    const Player& me = s.P[i]; int t = s.au.type, have = me.animals[t]; double money = isum(me.money);
    double want = VAL[t] * 0.18 * (1 + 0.6 * have) + 20;
    return tens(jmin(money * 0.7, want * noise(rand, 0.35)));
  }
  Move act(Game& s, int i, int what, Rng& rand) override {
    const Player& me = s.P[i]; double money = isum(me.money);
    if (what == W_TURN) {
      vector<Target> all, opts; targets(s, i, all);
      for (auto& o : all) if (o.free || me.animals[o.k] >= 2 || VAL[o.k] >= 500) opts.push_back(o);
      Move mv; mv.type = MV_KOEHANDEL;
      if (opts.size() && (s.deck.empty() || rand() < 0.35)) { auto& o = opts[(size_t)std::floor(rand() * opts.size())]; mv.target = o.p; mv.animal = o.k; return mv; }
      if (!s.deck.empty()) return mvType(MV_AUCTION);
      if (all.empty()) throw JsThrow{"TypeError: o is undefined"};
      mv.target = all[0].p; mv.animal = all[0].k; return mv;
    }
    const Auction& a = s.au;
    if (what == W_DECIDE) return mvType(me.animals[a.type] >= 1 && money >= a.highAmt && a.highAmt < VAL[a.type] * 0.25 ? MV_BUY : MV_SELL);
    if (what == W_PAY) return mvCards(MV_PAY, cheapest(me.money, a.highAmt));
    const Trade& tr = s.tr;
    if (what == W_OFFER) return mvCards(MV_TRADEBID, cheapest(me.money, tens(money * (0.3 + 0.3 * rand()))));
    double guess = (tr.hasBid[tr.a] ? tr.bids[tr.a].size() : 0) * 25.0;
    if (me.animals[tr.type] >= 2 && money > guess + 20) return mvCards(MV_TRADEBID, cheapest(me.money, tens(guess + 20 + 30 * rand())));
    return mvType(MV_ACCEPT);
  }
};

// ---- exploiters: v2 everywhere except for one trick (no opening bids: they only have cap)
inline Th plainTh(double mDec = NaN) { Th t = DEFAULTS(); t.merge(EXPERT()); if (mDec == mDec) t.set(T_mDec, mDec); return t; }
class Exploiter : public Agent {
 public:
  enum Kind { PADDER, CALLER, KEEN, SNIPER, HOARDER, SELLER } kind; ExpertAgent b;
  explicit Exploiter(Kind k) : kind(k), b(plainTh(k == HOARDER ? -0.15 : NaN)) {}
  double cap(Game& s, int i, Rng& r) override {
    double c = b.cap(s, i, r);
    if (kind == KEEN) return jmin(isum(s.P[i].money), tens(c * 1.3));
    if (kind == SNIPER) return s.P[i].animals[s.au.type] ? c : jmin(c, 10);
    return c;
  }
  Move act(Game& s, int i, int what, Rng& rand) override {
    if (kind == PADDER && what == W_OFFER) {
      vector<int> hand = s.P[i].money; std::stable_sort(hand.begin(), hand.end(), [](int x, int y) { return x - y < 0; });
      Obs o; look(s, i, nullptr, o); double mb = o.money[s.tr.b];
      if (rand() < 0.35 && mb + 10 <= isum(hand) * 0.6) return mvCards(MV_TRADEBID, cheapest(hand, mb + 10));
      vector<int> cards; int tot = 0;
      for (int c : hand) { if (c > 10 || tot + c > 30) break; cards.push_back(c); tot += c; }
      return mvCards(MV_TRADEBID, cards);
    }
    if (kind == CALLER && what == W_RESPOND) {
      const Trade& tr = s.tr; int n = (int)tr.bids[tr.a].size(); Obs o; look(s, i, nullptr, o);
      double avg = o.money[tr.a] / std::max(1, o.cards[tr.a]);
      double y = tens(jmin(o.money[tr.a], n * avg) * (0.9 + 0.5 * rand())) + 10, m = isum(s.P[i].money);
      if (y > m) return b.act(s, i, what, rand);
      return mvCards(MV_TRADEBID, cheapest(s.P[i].money, y));
    }
    if (kind == SELLER && what == W_DECIDE) return mvType(MV_SELL);
    return b.act(s, i, what, rand);
  }
};

// ---- a little JSON (for agent/runs/specs2.json and agent/cpp/levels.json)
struct JV {
  enum T { NUL, NUM, STR, OBJ, ARR, BOOL } t = NUL; double num = 0; std::string str; vector<std::pair<std::string, JV>> obj; vector<JV> arr;
  const JV* get(const std::string& k) const { for (auto& [a, v] : obj) if (a == k) return &v; return nullptr; }
};
inline JV parseJson(const char*& p) {
  auto ws = [&] { while (*p && isspace((unsigned char)*p)) p++; };
  ws(); JV v;
  if (*p == '{') { p++; v.t = JV::OBJ; ws(); if (*p == '}') { p++; return v; }
    for (;;) { ws(); JV k = parseJson(p); ws(); if (*p != ':') throw std::runtime_error("json: expected :"); p++; JV x = parseJson(p); v.obj.push_back({k.str, std::move(x)}); ws(); if (*p == ',') { p++; continue; } if (*p == '}') { p++; break; } throw std::runtime_error("json: expected , or }"); } return v; }
  if (*p == '[') { p++; v.t = JV::ARR; ws(); if (*p == ']') { p++; return v; }
    for (;;) { v.arr.push_back(parseJson(p)); ws(); if (*p == ',') { p++; continue; } if (*p == ']') { p++; break; } throw std::runtime_error("json: expected , or ]"); } return v; }
  if (*p == '"') { p++; v.t = JV::STR; while (*p && *p != '"') { if (*p == '\\') p++; v.str += *p++; } p++; return v; }
  if (!strncmp(p, "true", 4)) { p += 4; v.t = JV::BOOL; v.num = 1; return v; }
  if (!strncmp(p, "false", 5)) { p += 5; v.t = JV::BOOL; v.num = 0; return v; }
  if (!strncmp(p, "null", 4)) { p += 4; return v; }
  char* e; v.num = strtod(p, &e); if (e == p) throw std::runtime_error("json: bad value"); p = e; v.t = JV::NUM; return v;
}
inline bool readFile(const std::string& path, std::string& out) { std::ifstream f(path, std::ios::binary); if (!f) return false; std::stringstream ss; ss << f.rdbuf(); out = ss.str(); return true; }
inline Th thFromJson(const JV& j) {
  Th t;
  for (auto& [k, v] : j.obj) {
    if (k == "small") { t.small = std::make_shared<Th>(thFromJson(v)); continue; }
    if (k == "solo") { t.solo = std::make_shared<Th>(thFromJson(v)); continue; }
    int key = thKey(k); if (key < 0) throw std::runtime_error("unsupported bot setting " + k);
    t.set(key, v.num);
  }
  return t;
}
struct Spec { std::string kind; Th th; double noise = 0, slip = 0; };
inline Spec specFromJson(const JV& j) {
  Spec s; const JV* k = j.get("kind"); s.kind = k ? k->str : "";
  if (const JV* th = j.get("th")) s.th = thFromJson(*th);
  if (const JV* x = j.get("noise")) s.noise = x->num;
  if (const JV* x = j.get("slip")) s.slip = x->num;
  return s;
}

// The registry (agent/scripts/registry.mjs). Files are looked up from the repository root (the working directory,
// or KH_ROOT).
struct Registry {
  std::map<std::string, Spec> levels, extra; std::map<std::string, std::string> bad; Th defaults, expert; bool loaded = false;
  std::map<std::string, std::unique_ptr<Agent>> cache;
  static std::string root() { const char* r = getenv("KH_ROOT"); return r ? std::string(r) + "/" : std::string(); }
  void load() {
    if (loaded) return;
    std::string txt;
    // the levels come from lib/bots (they change while the bots are worked on): refreshed on every start unless
    // KH_NO_REFRESH is set (then agent/cpp/levels.json is used as it is)
    if (!getenv("KH_NO_REFRESH")) { std::string cmd = "node " + root() + "agent/cpp/levels.mjs 2>" + (std::string)NULLDEV; if (system(cmd.c_str()) != 0) fprintf(stderr, "(could not refresh agent/cpp/levels.json, using it as it is)\n"); }
    if (!readFile(root() + "agent/cpp/levels.json", txt)) throw std::runtime_error("agent/cpp/levels.json missing: run node agent/cpp/levels.mjs (build.sh does) from the repository root");
    const char* p = txt.c_str(); JV j = parseJson(p);
    defaults = thFromJson(*j.get("DEFAULTS")); expert = thFromJson(*j.get("EXPERT"));
    for (auto& [k, v] : j.get("levels")->obj) levels[k] = specFromJson(v);
    if (const JV* t = j.get("TRACKER")) { // the card tracker's settings (lib/bots/tracker.js)
      TrackerSettings& T = TRACKER();
      for (auto& [k, v] : t->obj) { if (k == "K") T.K = (int)v.num; else if (k == "TILT") T.TILT = v.num; else if (k == "FLOOR") T.FLOOR = v.num; else if (k == "choices") T.choices = truthy(v.num); else if (k == "sums") T.sums = truthy(v.num); else if (k == "BOLD") T.BOLD = v.num; else if (k == "BOLDH") T.BOLDH = v.num; else if (k == "BOLDN") T.BOLDN = v.num; else if (k == "BOLDAT") T.BOLDAT = v.num; else throw std::runtime_error("unsupported TRACKER setting " + k); }
    }
    if (const JV* ns = j.get("NETS")) for (auto& [id, v] : ns->obj) { // the learned position models (lib/bots/nets.js)
      Net net; net.n = (int)v.get("players")->num; if (const JV* st = v.get("style")) net.style = truthy(st->num); if (const JV* sz = v.get("size")) net.size = (int)sz->num; if (const JV* ar = v.get("arch")) net.rm = ar->str == "c"; net.ft = (int)v.get("ft")->num; net.fp = (int)v.get("fp")->num;
      const JV& w = *v.get("weights");
      // matrices transposed ([in][out], for ndense in brain.h), biases as they are
      auto mat = [&](const char* k, vector<double>& out) { out.clear(); const JV& m = *w.get(k); if (m.t == JV::ARR && m.arr.size() && m.arr[0].t == JV::ARR) { const size_t R = m.arr.size(), C = m.arr[0].arr.size(); out.resize(R * C); for (size_t r = 0; r < R; r++) for (size_t c = 0; c < C; c++) out[c * R + r] = m.arr[r].arr[c].num; } else for (auto& x : m.arr) out.push_back(x.num); return (int)m.arr.size(); };
      net.H = mat("t.0.weight", net.t0w); mat("t.0.bias", net.t0b); net.E = mat("t.2.weight", net.t2w); mat("t.2.bias", net.t2b);
      net.H2 = mat("p.0.weight", net.p0w); mat("p.0.bias", net.p0b); mat("p.2.weight", net.p2w); mat("p.2.bias", net.p2b); mat("p.4.weight", net.p4w); mat("p.4.bias", net.p4b);
      if (net.E > 128 || net.H > 128 || net.H2 > 256 || net.ft > 16 || net.E + net.fp > 256) throw std::runtime_error("network " + id + " too large for brain.h's buffers");
      NETS()[atoi(id.c_str())] = std::move(net);
    }
    if (readFile(root() + "agent/runs/specs2.json", txt)) { p = txt.c_str(); JV e = parseJson(p); for (auto& [k, v] : e.obj) { try { extra[k] = specFromJson(v); } catch (std::exception& x) { bad[k] = x.what(); } } }
    loaded = true;
  }
  Registry() {}
  Registry(const Registry&) = delete;
  // the same settings, agents of its own (an agent keeps small caches, so every thread needs its own)
  Registry fork() const { Registry r; r.levels = levels; r.extra = extra; r.bad = bad; r.defaults = defaults; r.expert = expert; r.loaded = loaded; return r; }
  Registry(Registry&& o) : levels(std::move(o.levels)), extra(std::move(o.extra)), bad(std::move(o.bad)), defaults(o.defaults), expert(o.expert), loaded(o.loaded), cache(std::move(o.cache)) {}
  std::unique_ptr<Agent> make(const Spec& sp) {
    if (sp.kind != "expert") throw std::runtime_error("unsupported agent kind " + sp.kind);
    Th th = defaults; th.merge(sp.th);
    return std::make_unique<ExpertAgent>(th, sp.noise, sp.slip);
  }
  static std::map<std::string, double> overrides(const std::string& rest) {
    std::map<std::string, double> over; std::stringstream ss(rest); std::string kv;
    while (std::getline(ss, kv, ',')) { auto e = kv.find('='); std::string k = kv.substr(0, e), v = e == std::string::npos ? "" : kv.substr(e + 1); over[k] = v.empty() ? 0 : strtod(v.c_str(), nullptr); }
    return over;
  }
  Agent* get(const std::string& spec) {
    load();
    auto it = cache.find(spec); if (it != cache.end()) return it->second.get();
    std::unique_ptr<Agent> a;
    { auto b = bad.find(spec.substr(0, spec.find(':'))); if (b != bad.end()) throw std::runtime_error("spec " + b->first + " in specs2.json: " + b->second); }
    if (spec == "v2") { Spec s; s.kind = "expert"; s.th = expert; a = make(s); }
    else if (spec == "v3") { Spec s; s.kind = "expert"; s.th = expert; s.th.set(T_solve, 1); s.th.set(T_solveK, 13); s.th.set(T_solveIt, 80); s.th.set(T_solveEps, 0.04); a = make(s); }
    else if (spec == "novice") a = std::make_unique<Novice>();
    else if (spec == "shark") a = std::make_unique<Shark>();
    else if (spec == "padder") a = std::make_unique<Exploiter>(Exploiter::PADDER);
    else if (spec == "caller") a = std::make_unique<Exploiter>(Exploiter::CALLER);
    else if (spec == "keen") a = std::make_unique<Exploiter>(Exploiter::KEEN);
    else if (spec == "sniper") a = std::make_unique<Exploiter>(Exploiter::SNIPER);
    else if (spec == "hoarder") a = std::make_unique<Exploiter>(Exploiter::HOARDER);
    else if (spec == "seller") a = std::make_unique<Exploiter>(Exploiter::SELLER);
    else if (extra.count(spec)) a = make(extra[spec]);
    else if (spec.rfind("v2:", 0) == 0) { Spec s; s.kind = "expert"; s.th = expert; for (auto& [k, v] : overrides(spec.substr(3))) { int key = thKey(k); if (key < 0) throw std::runtime_error("unsupported setting " + k); s.th.set(key, v); } a = make(s); }
    else if (levels.count(spec)) a = make(levels[spec]);
    else {
      auto c = spec.find(':'); std::string lv = spec.substr(0, c);
      if (c == std::string::npos || (!levels.count(lv) && !extra.count(lv))) throw std::runtime_error("unknown agent " + spec);
      std::string rest = spec.substr(c + 1); auto c2 = rest.find(':'); if (c2 != std::string::npos) rest = rest.substr(0, c2);
      Spec base = levels.count(lv) ? levels[lv] : extra[lv];
      Th small = base.th.small ? *base.th.small : Th(); bool anySmall = (bool)base.th.small;
      Th solo = base.th.solo ? *base.th.solo : Th(); bool anySolo = (bool)base.th.solo;
      Th over;
      for (auto& [k, v] : overrides(rest)) {
        if (k.rfind("small.", 0) == 0) { int key = thKey(k.substr(6)); if (key < 0) throw std::runtime_error("unsupported setting " + k); small.set(key, v); anySmall = true; continue; }
        if (k.rfind("solo.", 0) == 0) { int key = thKey(k.substr(5)); if (key < 0) throw std::runtime_error("unsupported setting " + k); solo.set(key, v); anySolo = true; continue; }
        int key = thKey(k); if (key < 0) throw std::runtime_error("unsupported setting " + k + " (experiment hooks are JS-only)");
        over.set(key, v);
      }
      base.th.merge(over);
      if (anySmall) base.th.small = std::make_shared<Th>(small);
      if (anySolo) base.th.solo = std::make_shared<Th>(solo);
      a = make(base);
    }
    Agent* r = a.get(); cache[spec] = std::move(a); return r;
  }
};
}  // namespace kh
