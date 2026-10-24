// Games in parallel (agent/scripts/pool.mjs and worker.mjs): std::thread workers, each with its own agents.
#pragma once
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <mutex>
#include <thread>
#include "agents.h"

namespace kh {
struct GameJob { vector<std::string> specs; int seed = 1, size = 40, seat = 0; bool vs = false; int deal = 0; };
struct GameResult { vector<int> scores; vector<double> wins; bool done = false; int errors = 0; std::string lastError; };

inline GameResult playGame(Registry& reg, const GameJob& g) {
  Rng r((uint32_t)g.seed); Game s; int n = (int)g.specs.size();
  newSimGame(s, n, g.size ? g.size : 40, r);
  vector<Agent*> ag; for (auto& sp : g.specs) ag.push_back(reg.get(sp));
  for (int j = 0; j < n; j++) s.person[j] = ag[j]->isPerson();
  GameResult res; res.scores = playOut(s, ag.data(), r);
  res.wins = wins(res.scores); res.done = s.phase == PH_OVER; res.errors = s.errors; res.lastError = s.lastError;
  return res;
}
inline int poolSize() { const char* p = getenv("POOL"); if (p && atoi(p) > 0) return atoi(p); int h = (int)std::thread::hardware_concurrency(); return std::max(1, h - 1); }
// Plays all games (any order), results in the order of the jobs. reg: loaded once; each worker gets a copy.
inline vector<GameResult> playAll(const Registry& reg, const vector<GameJob>& jobs, int threads = poolSize()) {
  vector<GameResult> out(jobs.size()); std::atomic<size_t> next{0}; std::mutex em; std::string err;
  auto work = [&] {
    Registry mine = reg.fork();
    for (;;) {
      size_t i = next++; if (i >= jobs.size()) break;
      try { out[i] = playGame(mine, jobs[i]); } catch (std::exception& e) { std::lock_guard<std::mutex> l(em); err = e.what(); next = jobs.size(); }
    }
  };
  vector<std::thread> ts; int T = std::min<int>(threads, (int)jobs.size()); for (int t = 0; t < std::max(1, T); t++) ts.emplace_back(work);
  for (auto& t : ts) t.join();
  if (!err.empty()) throw std::runtime_error(err);
  return out;
}
// Duplicate-style match (pool.mjs duplicate): every deal once with the candidate in each seat, the field cycled.
inline vector<GameJob> duplicate(const std::string& cand, const vector<std::string>& field, int deals, int players, int size, int seed0) {
  vector<GameJob> games;
  for (int d = 0; d < deals; d++) for (int seat = 0; seat < players; seat++) {
    GameJob g; int f = 0;
    for (int i = 0; i < players; i++) g.specs.push_back(i == seat ? cand : field[(d + f++) % field.size()]);
    g.seed = seed0 + d; g.size = size; g.seat = seat; g.deal = seed0 + d; games.push_back(g);
  }
  return games;
}
inline vector<std::string> split(const std::string& s, char c) { vector<std::string> out; std::string x; std::stringstream ss(s); while (std::getline(ss, x, c)) out.push_back(x); return out; }
// Number.prototype.toFixed (round half up on the exact value, as JS does)
inline std::string toFixed(double x, int d) {
  if (!std::isfinite(x)) return x != x ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
  bool neg = x < 0; long double y = std::fabs((long double)x), sc = 1; for (int i = 0; i < d; i++) sc *= 10;
  long double n = floorl(y * sc + 0.5L);
  char buf[64]; unsigned long long N = (unsigned long long)n, ip = N / (unsigned long long)sc, fp = N % (unsigned long long)sc;
  if (d) snprintf(buf, sizeof buf, "%s%llu.%0*llu", neg && N ? "-" : "", ip, d, fp); else snprintf(buf, sizeof buf, "%s%llu", neg && N ? "-" : "", ip);
  return buf;
}
inline double secondsSince(std::chrono::steady_clock::time_point t0) { return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(); }
}  // namespace kh
