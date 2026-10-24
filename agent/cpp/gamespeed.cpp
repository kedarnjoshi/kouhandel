// agent/scripts/gamespeed.mjs in C++: time for whole games (one thread):
//   gamespeed <spec> [games 20] [deck size 20] [players 3]
#include "pool.h"
using namespace kh;
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "gamespeed <spec> [games] [deck size] [players]\n"); return 1; }
  std::string spec = argv[1]; int games = argc > 2 ? atoi(argv[2]) : 20, size = argc > 3 ? atoi(argv[3]) : 20, players = argc > 4 ? atoi(argv[4]) : 3;
  try {
    Registry reg; reg.load(); Agent* a = reg.get(spec);
    auto t0 = std::chrono::steady_clock::now();
    for (int g = 0; g < games; g++) { Rng r(g + 1); Game s; newSimGame(s, players, size, r); vector<Agent*> ag(players, a); playOut(s, ag.data(), r); }
    printf("%s: %s ms per game (%d cards, %d players)\n", spec.c_str(), toFixed(secondsSince(t0) * 1000 / games, 1).c_str(), size, players);
#ifdef KH_PROF
    for (auto& [k, v] : profTab()) printf("  %-14s %9.1f ms  %9lld calls\n", k.c_str(), v.t * 1000 / games, v.n / games);
#endif
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
