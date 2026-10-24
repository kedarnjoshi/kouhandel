// agent/scripts/tune5.mjs in C++: sep-CMA-ES on some of a bot's parameters against a mixed field (vs:x entries too):
//   tune5 <run name> <generations> <base> <field a;b;vs:x> <sizes 20,40> <players 3> <params name:low:high[:log],...>
// env DEALS (40), LAMBDA (10), SIGMA (0.2), START (k=v,...), POOL, and SEED for the search's own random numbers (the
// JS uses Math.random, so runs differ from it anyway; the games of a given candidate are the same).
// FIT=soft:T scores the worst opponent rather than the average: every field entry is played on its own (two of it, or
// vs:x as usual), the base plays the same deals, and a candidate's fitness is a soft minimum over the entries of its
// gain on the base, -T log(mean exp(-gain/T)). A trade (much better against one, worse against another) then loses to
// a change that is a little better everywhere. T small is the plain minimum, T large the plain average.
// Writes agent/runs/<name>.jsonl and agent/runs/<name>.final.txt as the JS does (run from the repository root).
#include <charconv>
#include <random>
#include "pool.h"
using namespace kh;
// Number -> String as JS prints it (shortest round trip)
static std::string jsnum(double x) {
  if (x == 0) return "0";
  if (!std::isfinite(x)) return x != x ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
  char b[64]; double a = std::fabs(x);
  auto r = (a >= 1e-6 && a < 1e21) ? std::to_chars(b, b + 64, x, std::chars_format::fixed) : std::to_chars(b, b + 64, x, std::chars_format::scientific);
  std::string s(b, r.ptr);
  auto e = s.find('e');
  if (e != std::string::npos) { std::string m = s.substr(0, e); int v = atoi(s.substr(e + 1).c_str()); s = m + "e" + (v >= 0 ? "+" : "-") + std::to_string(std::abs(v)); }
  return s;
}
// +x.toPrecision(3)
static double toPrecision3(double x) { char b[64]; snprintf(b, sizeof b, "%.2e", x); return strtod(b, nullptr); }

int main(int argc, char** argv) {
  std::string name = argc > 1 ? argv[1] : "tune5", base = argc > 3 ? argv[3] : "insane", fieldArg = argc > 4 ? argv[4] : "insane;hard",
              sizesArg = argc > 5 ? argv[5] : "20", playersArg = argc > 6 ? argv[6] : "3", paramsArg = argc > 7 ? argv[7] : "";
  int gens = argc > 2 ? atoi(argv[2]) : 20;
  struct P { std::string k; double lo, hi; bool lg; };
  vector<P> SPACE;
  for (auto& p : split(paramsArg, ',')) {
    auto f = split(p, ':');
    if (f.size() < 3) { fprintf(stderr, "bad parameter %s (name:low:high[:log])\n", p.c_str()); return 1; }
    SPACE.push_back({f[0], atof(f[1].c_str()), atof(f[2].c_str()), f.size() > 3 && f[3] == "log"});
  }
  const int N = (int)SPACE.size();
  if (!N) { fprintf(stderr, "no parameters to tune\n"); return 1; }
  const double softT = getenv("FIT") && std::string(getenv("FIT")).rfind("soft:", 0) == 0 ? atof(getenv("FIT") + 5) : 0;
  int DEALS = getenv("DEALS") ? atoi(getenv("DEALS")) : 40, lambda = getenv("LAMBDA") ? atoi(getenv("LAMBDA")) : 10;
  auto field = split(fieldArg, ';');
  vector<int> sizes, players;
  for (auto& x : split(sizesArg, ',')) sizes.push_back(atoi(x.c_str()));
  for (auto& x : split(playersArg, ',')) players.push_back(atoi(x.c_str()));
  auto fromUnit = [&](const vector<double>& u) {
    vector<std::pair<std::string, double>> out;
    for (int i = 0; i < N; i++) { const P& s = SPACE[i]; double x = jmin(1, jmax(0, u[i])); out.push_back({s.k, toPrecision3(s.lg ? s.lo * std::pow(s.hi / s.lo, x) : s.lo + (s.hi - s.lo) * x)}); }
    return out;
  };
  auto specOf = [&](const vector<double>& u) {
    std::string s = base + ":"; bool first = true;
    for (auto& [k, v] : fromUnit(u)) { if (!first) s += ","; first = false; s += k + "=" + jsnum(v); }
    return s;
  };
  std::mt19937_64 rng64(getenv("SEED") ? strtoull(getenv("SEED"), nullptr, 10) : std::random_device{}());
  std::uniform_real_distribution<double> U01(0, 1);
  auto gauss = [&] { double a = std::sqrt(-2 * std::log(1 - U01(rng64))); return a * std::cos(2 * 3.141592653589793 * U01(rng64)); };
  std::map<std::string, double> start;
  if (getenv("START")) for (auto& kv : split(getenv("START"), ',')) { auto e = kv.find('='); if (e != std::string::npos) start[kv.substr(0, e)] = atof(kv.substr(e + 1).c_str()); }
  vector<double> m(N);
  for (int i = 0; i < N; i++) { const P& s = SPACE[i]; m[i] = start.count(s.k) ? (s.lg ? std::log(start[s.k] / s.lo) / std::log(s.hi / s.lo) : (start[s.k] - s.lo) / (s.hi - s.lo)) : 0.5; }

  const int mu = lambda / 2;
  vector<double> w(mu); double ws = 0;
  for (int i = 0; i < mu; i++) { w[i] = std::log(mu + 0.5) - std::log(i + 1.0); ws += w[i]; }
  for (auto& x : w) x /= ws;
  double mueff = 0; for (double x : w) mueff += x * x; mueff = 1 / mueff;
  const double cs = (mueff + 2) / (N + mueff + 5), ds = 1 + 2 * jmax(0, std::sqrt((mueff - 1) / (N + 1)) - 1) + cs;
  const double cc = (4 + mueff / N) / (N + 4 + 2 * mueff / N);
  const double c1 = 2 / ((N + 1.3) * (N + 1.3) + mueff) * (N + 2) / 3, cmu = jmin(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((N + 2.0) * (N + 2.0) + mueff) * (N + 2) / 3);
  const double chiN = std::sqrt((double)N) * (1 - 1.0 / (4 * N) + 1.0 / (21.0 * N * N));
  double sigma = getenv("SIGMA") ? atof(getenv("SIGMA")) : 0.2;
  vector<double> C(N, 1), ps(N, 0), pc(N, 0);
  const std::string logFile = "agent/runs/" + name + ".jsonl";
  try {
    Registry reg; reg.load();
    vector<std::string> plain, vs;
    for (auto& f : field) { if (f.rfind("vs:", 0) == 0) vs.push_back(f.substr(3)); else plain.push_back(f); }
    for (auto& f : plain) reg.get(f);
    for (auto& f : vs) reg.get(f);
    reg.get(specOf(m)); // unknown names or settings fail here, not in the middle of a generation
    // every candidate plays the same duplicate deals; vs:x is the other side (x alone against the candidate)
    // FIT=soft:T: each entry on its own; the last spec is the base, the others are scored by their gains on it
    vector<std::string> gains; // the reference's gain per entry, for the log
    auto evaluateSoft = [&](const vector<std::string>& specs, int seed0) {
      const size_t E = plain.size() + vs.size();
      vector<GameJob> games; vector<std::pair<int, int>> owner;
      for (size_t ci = 0; ci < specs.size(); ci++) for (int n : players) for (int size : sizes) {
        int seed = seed0 + n * 1000 + size * 10;
        for (size_t e = 0; e < plain.size(); e++) for (auto& g : duplicate(specs[ci], {plain[e]}, DEALS, n, size, seed)) { games.push_back(g); owner.push_back({(int)ci, (int)e}); }
        for (size_t e = 0; e < vs.size(); e++) for (auto g : duplicate(vs[e], {specs[ci]}, DEALS, n, size, seed)) { g.vs = true; games.push_back(g); owner.push_back({(int)ci, (int)(plain.size() + e)}); }
      }
      auto res = playAll(reg, games);
      vector<vector<double>> sc(specs.size(), vector<double>(E, 0)), cnt = sc;
      for (size_t i = 0; i < res.size(); i++) {
        auto [ci, e] = owner[i]; int n = (int)games[i].specs.size();
        sc[ci][e] += games[i].vs ? (1 - res[i].wins[games[i].seat]) * n / (n - 1) : res[i].wins[games[i].seat] * n; cnt[ci][e]++;
      }
      for (size_t ci = 0; ci < specs.size(); ci++) for (size_t e = 0; e < E; e++) sc[ci][e] /= cnt[ci][e];
      vector<double> out; const auto& b = sc.back();
      for (size_t ci = 0; ci + 1 < specs.size(); ci++) {
        double z = 0; for (size_t e = 0; e < E; e++) z += std::exp(-(sc[ci][e] - b[e]) / softT);
        out.push_back(-softT * std::log(z / E));
      }
      gains.clear(); const auto& r = sc[specs.size() - 2]; // the reference (the current mean) comes just before the base
      for (size_t e = 0; e < E; e++) gains.push_back(toFixed(r[e] - b[e], 2));
      return out;
    };
    auto evaluate = [&](vector<std::string> specs, int seed0) {
      if (softT > 0) { specs.push_back(base); return evaluateSoft(specs, seed0); }
      vector<GameJob> games; vector<int> owner;
      for (size_t ci = 0; ci < specs.size(); ci++) for (int n : players) for (int size : sizes) {
        int seed = seed0 + n * 1000 + size * 10;
        if (plain.size()) for (auto& g : duplicate(specs[ci], plain, DEALS, n, size, seed)) { games.push_back(g); owner.push_back((int)ci); }
        for (auto& x : vs) for (auto g : duplicate(x, {specs[ci]}, DEALS, n, size, seed)) { g.vs = true; games.push_back(g); owner.push_back((int)ci); }
      }
      auto res = playAll(reg, games);
      vector<std::pair<double, int>> fit(specs.size(), {0.0, 0});
      for (size_t i = 0; i < res.size(); i++) {
        auto& f = fit[owner[i]]; int n = (int)games[i].specs.size();
        f.first += games[i].vs ? (1 - res[i].wins[games[i].seat]) * n / (n - 1) : res[i].wins[games[i].seat] * n; f.second++;
      }
      vector<double> out; for (auto& [a, b] : fit) out.push_back(a / b);
      return out;
    };
    for (int g = 0; g < gens; g++) {
      auto t0 = std::chrono::steady_clock::now();
      vector<vector<double>> ys, xs;
      for (int k = 0; k < lambda; k++) {
        vector<double> y(N), x(N);
        for (int i = 0; i < N; i++) y[i] = gauss() * std::sqrt(C[i]);
        for (int i = 0; i < N; i++) x[i] = m[i] + sigma * y[i];
        ys.push_back(y); xs.push_back(x);
      }
      vector<std::string> specs; for (auto& x : xs) specs.push_back(specOf(x));
      specs.push_back(specOf(m)); // the current mean plays too (a reference)
      auto fit = evaluate(specs, 70000 + g * 7919); double ref = fit.back(); fit.pop_back();
      vector<int> order(fit.size()); for (size_t i = 0; i < order.size(); i++) order[i] = (int)i;
      std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return fit[b] - fit[a] < 0; });
      vector<double> ymean(N, 0);
      for (int r = 0; r < mu; r++) for (int i = 0; i < N; i++) ymean[i] += w[r] * ys[order[r]][i];
      for (int i = 0; i < N; i++) m[i] = jmin(1.05, jmax(-0.05, m[i] + sigma * ymean[i]));
      for (int i = 0; i < N; i++) ps[i] = (1 - cs) * ps[i] + std::sqrt(cs * (2 - cs) * mueff) * ymean[i] / std::sqrt(C[i]);
      double psn = 0; for (double x : ps) psn += x * x; psn = std::sqrt(psn);
      int hs = psn / std::sqrt(1 - std::pow(1 - cs, 2 * (g + 1))) < (1.4 + 2.0 / (N + 1)) * chiN ? 1 : 0;
      for (int i = 0; i < N; i++) {
        pc[i] = (1 - cc) * pc[i] + hs * std::sqrt(cc * (2 - cc) * mueff) * ymean[i];
        double rank = 0; for (int r = 0; r < mu; r++) rank += w[r] * ys[order[r]][i] * ys[order[r]][i];
        C[i] = (1 - c1 - cmu) * C[i] + c1 * (pc[i] * pc[i] + (1 - hs) * cc * (2 - cc) * C[i]) + cmu * rank;
      }
      sigma = jmin(0.4, sigma * std::exp((cs / ds) * (psn / chiN - 1)));
      double avg = 0; for (double f : fit) avg += f; avg /= fit.size();
      double secs = std::round(secondsSince(t0) * 1000) / 1000;
      std::string mean = "{"; bool first = true;
      for (auto& [k, v] : fromUnit(m)) { mean += std::string(first ? "" : ",") + "\"" + k + "\":" + jsnum(v); first = false; }
      mean += "}";
      if (softT > 0) { mean += ",\"gains\":["; for (size_t e = 0; e < gains.size(); e++) mean += (e ? "," : "") + gains[e]; mean += "]"; }
      std::string line = "{\"gen\":" + std::to_string(g) + ",\"ref\":" + jsnum(ref) + ",\"best\":" + jsnum(fit[order[0]]) + ",\"avg\":" + jsnum(avg) +
                         ",\"sigma\":" + jsnum(sigma) + ",\"mean\":" + mean + ",\"secs\":" + jsnum(secs) + "}";
      if (FILE* f = fopen(logFile.c_str(), "ab")) { fprintf(f, "%s\n", line.c_str()); fclose(f); }
      printf("gen %d centre %s best %s avg %s sigma %s %s %ss\n", g, toFixed(ref, 3).c_str(), toFixed(fit[order[0]], 3).c_str(), toFixed(avg, 3).c_str(),
             toFixed(sigma, 3).c_str(), specOf(m).c_str(), jsnum(secs).c_str());
      if (softT > 0) { printf("  centre's gain on the base per entry:"); for (auto& x : gains) printf(" %s", x.c_str()); printf("\n"); }
      fflush(stdout);
    }
    if (FILE* f = fopen(("agent/runs/" + name + ".final.txt").c_str(), "wb")) { fprintf(f, "%s\n", specOf(m).c_str()); fclose(f); }
  } catch (std::exception& e) { fprintf(stderr, "error: %s\n", e.what()); return 1; }
}
