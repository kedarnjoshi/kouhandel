// agent/scripts/sprt.mjs in C++ (same deals, seeds and statistics):
//   sprt <candidate> <reference> <field a;b;vs:x> [deck size 20] [players 3] [max deals 400]   (env D, BATCH, POOL)
#include "pool.h"
using namespace kh;
int main(int argc, char** argv) {
  if (argc < 4) { fprintf(stderr, "sprt <candidate> <reference> <field a;b;vs:x> [deck size] [players] [max deals]\n"); return 1; }
  std::string cand = argv[1], ref = argv[2], fieldArg = argv[3];
  int size = argc > 4 ? atoi(argv[4]) : 20, n = argc > 5 ? atoi(argv[5]) : 3, maxDeals = argc > 6 ? atoi(argv[6]) : 400;
  double D = getenv("D") ? atof(getenv("D")) : 0.05; int BATCH = getenv("BATCH") ? atoi(getenv("BATCH")) : 16; const double ALPHA = 0.05, BETA = 0.05;
  double lo = std::log(BETA / (1 - ALPHA)), hi = std::log((1 - BETA) / ALPHA);
  vector<std::string> plain, vs; for (auto& f : split(fieldArg, ';')) { if (f.rfind("vs:", 0) == 0) vs.push_back(f.substr(3)); else plain.push_back(f); }
  try {
    Registry reg; reg.load(); reg.get(cand); reg.get(ref); for (auto& f : plain) reg.get(f); for (auto& f : vs) reg.get(f);
    auto t0 = std::chrono::steady_clock::now(); vector<double> diffs; double pc = 0, pr = 0;
    auto gamesFor = [&](const std::string& sp, int seed0) {
      vector<GameJob> out;
      if (plain.size()) for (auto& g : duplicate(sp, plain, BATCH, n, size, seed0)) out.push_back(g);
      for (auto& x : vs) for (auto g : duplicate(x, {sp}, BATCH, n, size, seed0)) { g.vs = true; out.push_back(g); }
      return out;
    };
    auto fit = [&](const GameJob& g, const GameResult& r) { return g.vs ? (1 - r.wins[g.seat]) * n / (n - 1) : r.wins[g.seat] * n; };
    std::string verdict = "undecided (max deals reached)";
    for (int done = 0; done < maxDeals; done += BATCH) {
      int seed0 = 31000 + done; auto gc = gamesFor(cand, seed0), gr = gamesFor(ref, seed0);
      vector<GameJob> all = gc; all.insert(all.end(), gr.begin(), gr.end());
      auto res = playAll(reg, all);
      struct DD { int deal; double c = 0, r = 0; int m = 0; }; vector<DD> byDeal; // insertion order, as the Map
      for (size_t i = 0; i < gc.size(); i++) {
        DD* d = nullptr; for (auto& x : byDeal) if (x.deal == gc[i].deal) d = &x;
        if (!d) { byDeal.push_back({gc[i].deal}); d = &byDeal.back(); }
        d->c += fit(gc[i], res[i]); d->r += fit(gr[i], res[gc.size() + i]); d->m++;
      }
      for (auto& d : byDeal) { diffs.push_back((d.c - d.r) / d.m); pc += d.c / d.m; pr += d.r / d.m; }
      double N = diffs.size(), mean = 0; for (double x : diffs) mean += x; mean /= N;
      double v = 0; for (double x : diffs) v += (x - mean) * (x - mean); v = jmax(1e-4, v / jmax(1, N - 1));
      double llr = (D / v) * (mean * N - N * D / 2);
      printf("%d deals: candidate %s reference %s diff %s%s \xC2\xB1%s  LLR %s (%s, %s)  %ss\n", (int)N, toFixed(pc / N, 3).c_str(), toFixed(pr / N, 3).c_str(), mean >= 0 ? "+" : "",
             toFixed(mean, 3).c_str(), toFixed(std::sqrt(v / N), 3).c_str(), toFixed(llr, 2).c_str(), toFixed(lo, 2).c_str(), toFixed(hi, 2).c_str(), toFixed(secondsSince(t0), 0).c_str());
      fflush(stdout);
      if (llr >= hi) { verdict = "better (by about " + toFixed(mean, 3) + ")"; break; }
      if (llr <= lo) { verdict = "not better (diff " + toFixed(mean, 3) + ")"; break; }
    }
    printf("%s vs %s on %s @%dp/%d: %s\n", cand.c_str(), ref.c_str(), fieldArg.c_str(), n, size, verdict.c_str());
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
