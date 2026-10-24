// agent/scripts/audit.mjs in C++ (regret audit: which kind of decision costs Insane the most?). Games are played with a
// lineup; at the decisions of seat 0 (buy-backs, and turn choices: auction or one of the three best koehandels) every
// option is played out ROLL times from the real position by the same agents, with the rest of the deck shuffled and
// the same luck for every option, and the share of wins for seat 0 is compared with what it chose. Games run in
// parallel; the rows are the JS script's, so its --sum reads them: node agent/scripts/audit.mjs --sum <out.jsonl>
//   audit <lineup a;b;c> <first game> <games> <deck size> <out.jsonl>   (env ROLL=40, EVERY=1: audit every n-th decision)
#include "pool.h"
using namespace kh;
int main(int argc, char** argv) {
  if (argc < 6) { fprintf(stderr, "audit <lineup a;b;c> <first game> <games> <deck size> <out.jsonl>\n"); return 1; }
  const auto names = split(argv[1], ';'); const int first = atoi(argv[2]), G = atoi(argv[3]), size = atoi(argv[4]), n = (int)names.size();
  const int ROLL = getenv("ROLL") ? atoi(getenv("ROLL")) : 40, EVERY = getenv("EVERY") ? std::max(1, atoi(getenv("EVERY"))) : 1;
  try {
    Registry reg; reg.load(); for (auto& nm : names) reg.get(nm);
    const Th th = forDeck(reg.levels.at("insane").th, size); // the options are Insane's view, as in the JS
    FILE* f = fopen(argv[5], "w"); if (!f) { fprintf(stderr, "cannot write %s\n", argv[5]); return 1; }
    std::mutex fm; std::atomic<int> next{0}, done{0}; auto t0 = std::chrono::steady_clock::now();
    auto stageOf = [&](const Game& s) { int d = (int)s.deck.size(); return d == 0 ? "empty" : d <= size / 4 ? "late" : d <= size / 2 ? "mid" : "early"; };
    auto work = [&] {
      Registry mine = reg.fork(); vector<Agent*> ag; for (auto& nm : names) ag.push_back(mine.get(nm));
      for (;;) {
        int g = first + next++; if (g >= first + G) break;
        Rng r((uint32_t)(5000 + g)); Game s; newSimGame(s, n, size, r); for (int j = 0; j < n; j++) s.person[j] = ag[j]->isPerson(); const int me = 0; int seen = 0;
        for (int step = 0; s.phase != PH_OVER && step < 1500; step++) {
          if (s.phase == PH_AUCTION && s.au.stage == ST_BIDDING) { settleAuction(s, ag.data(), r); continue; }
          Wait w = waiting(s); if (w.what == W_NONE) break;
          Move mv; bool ok = true;
          try { mv = ag[w.p]->act(s, w.p, w.what, r); } catch (JsThrow&) { ok = false; }
          if (ok && w.p == me && (w.what == W_DECIDE || w.what == W_TURN) && seen++ % EVERY == 0) {
            vector<std::string> opts; vector<Move> acts; int pick = -1;
            if (w.what == W_DECIDE) {
              if (isum(s.P[me].money) >= s.au.highAmt) { opts = {"buy", "sell"}; acts = {mvType(MV_BUY), mvType(MV_SELL)}; pick = mv.type == MV_BUY ? 0 : 1; }
            } else {
              Th t1 = th; Obs o; look(s, me, &t1, o); Model M(o, t1); Rng rr((uint32_t)(g * 31 + step));
              auto ko = koehandelOptions(o, t1, M, rr);
              std::stable_sort(ko.begin(), ko.end(), [](const KOpt& a, const KOpt& b) { return a.ev > b.ev; });
              if (ko.size() > 3) ko.resize(3);
              if (!s.deck.empty()) { opts.push_back("auction"); acts.push_back(mvType(MV_AUCTION)); }
              for (auto& t : ko) { Move m; m.type = MV_KOEHANDEL; m.target = t.p; m.animal = t.k; opts.push_back(std::string("kh ") + TYPES[t.k]); acts.push_back(m); }
              std::string mine_ = mv.type == MV_KOEHANDEL ? std::string("kh ") + TYPES[mv.animal] : "auction";
              for (size_t x = 0; x < opts.size(); x++) if (opts[x] == mine_) pick = (int)x;
              if (pick < 0) { opts.push_back(mine_); acts.push_back(mv); pick = (int)opts.size() - 1; }
              if (opts.size() < 2) opts.clear();
            }
            if (!opts.empty()) {
              const int K = (int)opts.size(); vector<vector<double>> vals(K);
              for (int q = 0; q < ROLL; q++) {
                uint32_t rs = (uint32_t)((g * 1000 + step) * 7919 + q * 104729);
                for (int x = 0; x < K; x++) {
                  Game c = s; Rng sh(rs + 1), rand(rs); shuffleR(c.deck, sh);
                  try { apply(c, me, acts[x], c.clock++); } catch (GameError&) { vals[x].push_back(NAN); continue; }
                  vals[x].push_back(wins(playOut(c, ag.data(), rand))[me]);
                }
              }
              vector<double> m(K); for (int x = 0; x < K; x++) { double t = 0; for (double v : vals[x]) t += v; m[x] = t / vals[x].size(); }
              int b1 = 0; for (int x = 1; x < K; x++) if (m[x] > m[b1]) b1 = x;
              int b2 = -1; for (int x = 0; x < K; x++) if (x != b1 && (b2 < 0 || m[x] > m[b2])) b2 = x;
              double md = 0, se = 0; vector<double> d; for (int q = 0; q < ROLL; q++) d.push_back(vals[b1][q] - vals[b2 < 0 ? b1 : b2][q]);
              for (double v : d) md += v; md /= d.size(); for (double v : d) se += (v - md) * (v - md); se = std::sqrt(se / std::max<size_t>(1, d.size() - 1) / d.size());
              std::string line = "{\"g\":" + std::to_string(g) + ",\"what\":\"" + (w.what == W_DECIDE ? "decide" : "turn") + "\",\"stage\":\"" + stageOf(s) + "\",\"opts\":[";
              for (int x = 0; x < K; x++) line += (x ? ",\"" : "\"") + opts[x] + "\"";
              line += "],\"pick\":" + std::to_string(pick) + ",\"vals\":[";
              for (int x = 0; x < K; x++) line += (x ? "," : "") + toFixed(m[x], 4);
              line += "],\"se\":" + toFixed(se, 4) + "}\n";
              std::lock_guard<std::mutex> l(fm); fputs(line.c_str(), f); fflush(f);
            }
          }
          long long t = s.clock++;
          try { if (!ok) throw GameError{"no move"}; apply(s, w.p, mv, t); } catch (GameError&) { s.due = t; tick(s, t); }
        }
        printf("game %d done (%d/%d, %ss)\n", g, ++done, G, toFixed(secondsSince(t0), 0).c_str()); fflush(stdout);
      }
    };
    vector<std::thread> ts; for (int t = 0; t < poolSize(); t++) ts.emplace_back(work);
    for (auto& t : ts) t.join();
    fclose(f);
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
