// The C++ counterpart of agent/cpp/movelog.mjs (same output, for diff):
//   movelog <spec1;spec2;...> <deck size> <first seed> <games>
#include "agents.h"
#include <fcntl.h>
#include <io.h>
using namespace kh;

static std::string num(double x) {
  char b[40];
  if (std::isfinite(x) && x == std::floor(x) && std::fabs(x) < 1e21) { if (x == 0) return "0"; snprintf(b, sizeof b, "%.0f", x); return b; }
  uint64_t u; memcpy(&u, &x, 8); snprintf(b, sizeof b, "x%016llx", (unsigned long long)u); return b;
}
static std::string list(const vector<int>& a) { std::string s = "["; for (size_t i = 0; i < a.size(); i++) { if (i) s += ","; s += num(a[i]); } return s + "]"; }
static std::string listd(const double* a, int n) { std::string s = "["; for (int i = 0; i < n; i++) { if (i) s += ","; s += num(a[i]); } return s + "]"; }
struct Log : Logger {
  vector<std::string>& out; Rng* r; explicit Log(vector<std::string>& o, Rng* rr) : out(o), r(rr) {}
  void bid(const Game&, int j, const Bid& b) override { out.push_back("bid " + std::to_string(j) + " " + num(b.cap) + " " + num(truthy(b.open) ? b.open : 0) + " rc=" + std::to_string(r->calls)); }
  void move(const Game&, int p, int what, const Move* m, const char*) override {
    std::string t = "move " + std::to_string(p) + " " + WHAT[what] + " ";
    if (!m) t += "ERR";
    else {
      t += MVN[m->type];
      if (m->type == MV_KOEHANDEL) t += " " + std::to_string(m->target) + " " + TYPES[m->animal];
      if (m->type == MV_PAY || m->type == MV_TRADEBID) t += " " + list(m->cards);
    }
    out.push_back(t + " rc=" + std::to_string(r->calls));
  }
};
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "movelog <spec1;spec2;...> [deck size] [first seed] [games]\n"); return 1; }
  std::string lineup = argv[1]; int size = argc > 2 ? atoi(argv[2]) : 20, seed0 = argc > 3 ? atoi(argv[3]) : 1, games = argc > 4 ? atoi(argv[4]) : 1;
  vector<std::string> specs; { std::stringstream ss(lineup); std::string x; while (std::getline(ss, x, ';')) specs.push_back(x); }
  _setmode(_fileno(stdout), _O_BINARY);
  Registry reg; vector<std::string> out;
  try {
    for (int g = 0; g < games; g++) {
      int seed = seed0 + g; Rng r((uint32_t)seed); Game s; int n = (int)specs.size();
      newSimGame(s, n, size, r);
      out.push_back("game " + std::to_string(seed) + " " + lineup + " " + std::to_string(size));
      vector<Agent*> ag; for (auto& sp : specs) ag.push_back(reg.get(sp));
      for (int j = 0; j < n; j++) { s.person[j] = ag[j]->isPerson(); s.gang[j] = ag[j]->isGang(); }
      Log L(out, &r);
      playOut(s, ag.data(), r, 1500, &L);
      for (const HistE& e : s.hist) {
        if (e.t == 'm') out.push_back("h m " + std::to_string(e.amt) + " " + list(e.to));
        else if (e.t == 'a') {
          std::string mx = "{", pr = "{";
          for (int j = 0; j < MAXP; j++) { if (e.mx[j]) { if (mx.size() > 1) mx += ","; mx += std::to_string(j) + ":" + num(e.mx[j]); } if (e.hasPred[j]) { if (pr.size() > 1) pr += ","; pr += std::to_string(j) + ":" + num(e.pred[j]); } }
          std::string t = std::string("h a ") + TYPES[e.k] + " A=" + std::to_string(e.A) + " w=" + std::to_string(e.w) + " p=" + std::to_string(e.p) + " buy=" + (e.buy ? "1" : "0") + " mx=" + mx + "} pred=" + pr + "} led=" + (e.hasLed ? listd(e.led, n) : "null");
          if (e.hasCards) t += " P=" + std::to_string(e.P) + " Q=" + std::to_string(e.Q) + " m=" + std::to_string(e.m) + " cs=" + list(e.cs);
          out.push_back(t);
        } else if (e.t == 'k') {
          out.push_back("h k a=" + std::to_string(e.a) + " b=" + std::to_string(e.b) + " " + TYPES[e.k] + " c=" + std::to_string(e.c) + " na=" + std::to_string(e.na) + " nb=" + (e.nb < 0 ? "null" : std::to_string(e.nb)) +
                        " win=" + std::to_string(e.win) + " x=" + std::to_string(e.x) + " y=" + (e.nb < 0 ? "null" : std::to_string(e.y)) + " ca=" + list(e.ca) + " cb=" + (e.nb < 0 ? "null" : list(e.cb)));
        }
      }
      for (int j = 0; j < n; j++) {
        vector<int> an(s.P[j].animals, s.P[j].animals + NT);
        out.push_back("p " + std::to_string(j) + " money=" + list(s.P[j].money) + " animals=" + list(an) + " score=" + std::to_string(score(s.P[j], s.counts).score) + " ledger=" + num(s.ledger[j]));
      }
      vector<int> cn(s.counts, s.counts + NT);
      const char* ph = s.phase == PH_OVER ? "over" : s.phase == PH_TURN ? "turn" : s.phase == PH_AUCTION ? "auction" : "trade";
      out.push_back(std::string("end phase=") + ph + " errors=" + std::to_string(s.errors) + " rc=" + std::to_string(r.calls) + " deck=" + std::to_string(s.deck.size()) + " counts=" + list(cn));
    }
  } catch (std::exception& e) { for (auto& l : out) puts(l.c_str()); fprintf(stderr, "error: %s\n", e.what()); return 1; }
  for (auto& l : out) puts(l.c_str());
}
