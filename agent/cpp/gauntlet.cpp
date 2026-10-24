// agent/scripts/gauntlet.mjs in C++: a candidate against several opponents in turn (each fills all other seats),
// duplicate deals, the same seeds, so the results equal the JS ones (exactly with KH_EXACT_MATH):
//   gauntlet <candidate> <opp1;opp2;...> [deals 60] [players 3] [deck size 40]   (an opponent may be a field: a|b)
#include "pool.h"
using namespace kh;
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "gauntlet <candidate> <opp1;opp2;...> [deals] [players] [deck size]\n"); return 1; }
  std::string cand = argv[1], opps = argc > 2 ? argv[2] : "v2;shark;caller;padder";
  int deals = argc > 3 ? atoi(argv[3]) : 60, n = argc > 4 ? atoi(argv[4]) : 3, size = argc > 5 ? atoi(argv[5]) : 40;
  try {
    Registry reg; reg.load();
    reg.get(cand); for (auto& o : split(opps, ';')) for (auto& f : split(o, '|')) reg.get(f); // unknown names fail here
    auto t0 = std::chrono::steady_clock::now(); vector<std::string> rows;
    for (auto& opp : split(opps, ';')) {
      auto games = duplicate(cand, split(opp, '|'), deals, n, size, 5000 + n);
      auto res = playAll(reg, games);
      int ne = 0; std::string e1; for (auto& r : res) if (r.errors) { if (!ne) e1 = r.lastError; ne++; }
      if (ne) printf("!! %d games with bot errors, e.g. %s\n", ne, e1.c_str());
      vector<double> w; for (size_t i = 0; i < res.size(); i++) w.push_back(res[i].wins[games[i].seat] * n);
      double m = 0; for (double x : w) m += x; m /= w.size();
      double v = 0; for (double x : w) v += (x - m) * (x - m); double sd = std::sqrt(v / w.size());
      rows.push_back(opp + ": " + toFixed(m, 2) + " \xC2\xB1" + toFixed(sd / std::sqrt((double)w.size()), 2));
      printf("  %s vs %s  (%ss)\n", cand.c_str(), rows.back().c_str(), toFixed(secondsSince(t0), 0).c_str()); fflush(stdout);
    }
    std::string all; for (size_t i = 0; i < rows.size(); i++) all += (i ? " | " : "") + rows[i];
    printf("%s @%dp%s: %s\n", cand.c_str(), n, size != 40 ? ("/" + std::to_string(size)).c_str() : "", all.c_str());
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
