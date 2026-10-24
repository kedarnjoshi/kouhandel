// Training data for a learned position value (agent/value): games between seats drawn from a pool of bots, a row per
// turn start (every position where a player is about to choose auction or koehandel) with what everyone holds and
// who won in the end.
//   datagen <pool a:w;b:w;...> <games> <players> <deck size> <out.bin> [first seed]
// Rows are float32 (agent/value/data.py reads them): deck size, cards left in the deck, mules drawn, whose turn,
// the deck left per type (10), the deck's composition (10), per player its animals (10), money, money cards and
// whether it left, then per player its wins share, score and pool index, and the game's seed; with STYLE=1 also, per
// player, how it has played so far as anyone at the table can see: its keenness (expert.js keenness: its top bids
// against a plain bidder's limit) and how often it bought back its own auctions (styleOf in lib/bots/value.js).
#include "pool.h"
using namespace kh;
int main(int argc, char** argv) {
  if (argc < 6) { fprintf(stderr, "datagen <pool a:w;b:w> <games> <players> <deck size> <out.bin> [first seed]\n"); return 1; }
  vector<std::string> names; vector<double> cum; double W = 0;
  for (auto& e : split(argv[1], ';')) {
    auto c = e.rfind(':'); double w = 1; std::string nm = e;
    if (c != std::string::npos && e.find('=', c) == std::string::npos) { w = atof(e.substr(c + 1).c_str()); nm = e.substr(0, c); }
    names.push_back(nm); W += w; cum.push_back(W);
  }
  const int G = atoi(argv[2]), n = atoi(argv[3]), size = atoi(argv[4]); const std::string out = argv[5];
  const int seed0 = argc > 6 ? atoi(argv[6]) : 1;
  const bool STYLE = getenv("STYLE") && atoi(getenv("STYLE"));
  const int ROW = 4 + 2 * NT + n * (NT + 3) + 3 * n + 1 + (STYLE ? 2 * n : 0);
  try {
    Registry reg; reg.load(); for (auto& nm : names) reg.get(nm);
    FILE* f = fopen(out.c_str(), "wb"); if (!f) { fprintf(stderr, "cannot write %s\n", out.c_str()); return 1; }
    std::mutex fm; std::atomic<int> next{0}, rows{0}; auto t0 = std::chrono::steady_clock::now();
    auto work = [&] {
      Registry mine = reg.fork();
      for (;;) {
        int g = next++; if (g >= G) break;
        int seed = seed0 + g; Rng pick((uint32_t)(seed * 2654435761u + 17)), r((uint32_t)seed);
        vector<int> who(n); vector<Agent*> ag(n);
        for (int j = 0; j < n; j++) { double u = pick() * W; int x = 0; while (x < (int)cum.size() - 1 && u > cum[x]) x++; who[j] = x; ag[j] = mine.get(names[x]); }
        Game s; newSimGame(s, n, size, r);
        vector<vector<float>> rs;
        for (int step = 0; s.phase != PH_OVER && step < 1500; step++) {
          if (s.phase == PH_AUCTION && s.au.stage == ST_BIDDING) { settleAuction(s, ag.data(), r); continue; }
          Wait w = waiting(s);
          if (w.what == W_NONE) break;
          if (w.what == W_TURN) {
            vector<float> row; int left[NT] = {0}; for (int c : s.deck) left[c]++;
            row.push_back((float)s.deckSize); row.push_back((float)s.deck.size()); row.push_back((float)s.mules); row.push_back((float)w.p);
            for (int k = 0; k < NT; k++) row.push_back((float)left[k]);
            for (int k = 0; k < NT; k++) row.push_back((float)s.counts[k]);
            for (int j = 0; j < n; j++) {
              for (int k = 0; k < NT; k++) row.push_back((float)s.P[j].animals[k]);
              row.push_back((float)isum(s.P[j].money)); row.push_back((float)s.P[j].money.size()); row.push_back(s.P[j].out ? 1.f : 0.f);
            }
            if (STYLE) { double kn[MAXP], bb[MAXP]; styleOf(s.hist, n, kn, bb); for (int j = 0; j < n; j++) { row.push_back((float)kn[j]); row.push_back((float)bb[j]); } }
            rs.push_back(std::move(row));
          }
          long long t = s.clock++;
          Move mv; bool ok = true;
          try { mv = ag[w.p]->act(s, w.p, w.what, r); } catch (JsThrow& e) { ok = false; s.errors++; }
          try { if (!ok) { tick(s, t); throw GameError{"no move"}; } apply(s, w.p, mv, t); } catch (GameError&) { s.due = t; tick(s, t); }
        }
        if (s.phase != PH_OVER || s.errors) continue; // only finished games without bot errors
        vector<int> sc(n); for (int j = 0; j < n; j++) sc[j] = score(s.P[j], s.counts).score;
        auto wn = wins(sc);
        std::lock_guard<std::mutex> l(fm);
        for (auto& row : rs) {
          for (int j = 0; j < n; j++) row.push_back((float)wn[j]);
          for (int j = 0; j < n; j++) row.push_back((float)sc[j]);
          for (int j = 0; j < n; j++) row.push_back((float)who[j]);
          row.push_back((float)seed);
          if (STYLE) { vector<float> st(row.end() - 3 * n - 1 - 2 * n, row.end() - 3 * n - 1); row.erase(row.end() - 3 * n - 1 - 2 * n, row.end() - 3 * n - 1); row.insert(row.end(), st.begin(), st.end()); }
          fwrite(row.data(), sizeof(float), ROW, f); rows++;
        }
        if ((g + 1) % 500 == 0) { printf("%d games, %d rows (%ss)\n", g + 1, rows.load(), toFixed(secondsSince(t0), 0).c_str()); fflush(stdout); }
      }
    };
    vector<std::thread> ts; for (int t = 0; t < poolSize(); t++) ts.emplace_back(work);
    for (auto& t : ts) t.join();
    fclose(f);
    printf("done: %d rows of %d floats (%ss)\n", rows.load(), ROW, toFixed(secondsSince(t0), 0).c_str());
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
