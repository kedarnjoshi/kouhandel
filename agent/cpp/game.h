// The game engine (lib/engine.js) as simulated games use it, and the self-play loop (lib/bots/sim.js): no lobby,
// no live clocks, no bots of the engine's own (sim players have no `bot` field), but the same clock arithmetic, the
// same history records, ledger and private memories, and the same handling of refused moves.
#pragma once
#include "common.h"

namespace kh {

enum Phase { PH_LOBBY, PH_TURN, PH_AUCTION, PH_TRADE, PH_OVER };
enum Stage { ST_BIDDING, ST_DECIDE, ST_PAY };
enum What { W_NONE, W_TURN, W_DECIDE, W_PAY, W_OFFER, W_RESPOND };
const char* const WHAT[] = {"none", "turn", "decide", "pay", "offer", "respond"};
enum MvType { MV_NONE, MV_AUCTION, MV_KOEHANDEL, MV_BID, MV_BUY, MV_SELL, MV_PAY, MV_TRADEBID, MV_ACCEPT };
const char* const MVN[] = {"none", "auction", "koehandel", "bid", "buy", "sell", "pay", "tradebid", "accept"};

struct Move { int type = MV_NONE; int target = -1, animal = -1, amount = 0; vector<int> cards; };
inline Move mvType(int t) { Move m; m.type = t; return m; }
inline Move mvCards(int t, vector<int> c) { Move m; m.type = t; m.cards = std::move(c); return m; }

struct HistE {
  char t = 0;
  // 'a': auction
  int k = 0, A = 0, w = -1, p = 0; bool buy = false; int mx[MAXP] = {0}; bool hasPred[MAXP] = {false}; int pred[MAXP] = {0};
  bool hasLed = false; double led[MAXP] = {0}; bool hasCards = false; int P = 0, Q = 0, m = 0; vector<int> cs;
  // 'k': koehandel (k as above)
  int a = 0, b = 0, c = 0, na = 0, nb = -1, win = 0, x = 0, y = -1; vector<int> ca, cb;
  // 'm': mule
  int amt = 0; vector<int> to;
};
struct Player { vector<int> money; int animals[NT] = {0}; bool out = false; };
struct Auction {
  int type = 0, auctioneer = 0; bool hasHigh = false; int highP = 0, highAmt = 0; int stage = ST_BIDDING;
  long long deadline = 0, at = 0; int nb = 0; int mx[MAXP] = {0}; bool hasPred[MAXP] = {false}; int pred[MAXP] = {0};
  bool hasLed = false; double led[MAXP] = {0}; int payer = 0, payee = 0;
};
struct Trade { int a = 0, b = 0, type = 0, count = 0; bool hasBid[MAXP] = {false}; vector<int> bids[MAXP]; int ties = 0; bool hasTieAt = false; int tieAt = 0; };
struct TrackState; // tracker.h
struct Game {
  int n = 0; Player P[MAXP]; int deckSize = 40; int counts[NT]; vector<int> deck; int mules = 0, turn = 0, phase = PH_LOBBY;
  bool hasAuction = false; Auction au; bool hasTrade = false; Trade tr;
  double ledger[MAXP] = {0}, mem[MAXP][MAXP] = {{0}}, unc[MAXP][MAXP] = {{0}};
  vector<HistE> hist; bool histCut = false; vector<std::array<int, 3>> khs;
  int32_t seed = 0; long long clock = 0, due = 0; int errors = 0; std::string lastError;
  bool gang[MAXP] = {false}; // simulations only: seats of th.gang stand-ins (their utility: own win chance + gang x the others' in the gang)
  bool person[MAXP] = {false}; // seats played by people (s.people in the JS; in simulations, specs with th.person)
  std::shared_ptr<TrackState> trk[MAXP]; // the card trackers' state per viewer (tracker.js keeps it in a WeakMap on s)
};
struct GameError { const char* msg; };
inline void need(bool c, const char* m) { if (!c) throw GameError{m}; }

const long long OPEN_MS = 20000, BID_MS = 10000, LIMIT_MS = 30000;

inline void ledgerAdd(Game& s, int j, double d) { s.ledger[j] += d; }
inline void know(Game& s, int i, int j, double d) { s.mem[i][j] += d; }
inline void secretDeal(Game& s, int a, int b, double pays, int na, int nb, bool aWins) {
  double tot = 0; int cnt = 0;
  for (int j = 0; j < s.n; j++) { tot += isum(s.P[j].money); cnt += (int)s.P[j].money.size(); }
  double avg = tot / std::max(1, cnt), own = jmin(3 * avg, jmax(0, s.ledger[a]) / std::max(1, (int)s.P[a].money.size()));
  double ownB = jmin(3 * avg, jmax(0, s.ledger[b]) / std::max(1, (int)s.P[b].money.size()));
  double guess = !nb ? 0.17 * na * avg + 0.396 * na * own
                 : aWins ? 0.159 * na * avg + 0.093 * na * own + 0.164 * nb * avg + 0.08 * nb * ownB
                         : -(0.076 * na * avg + 0.143 * na * own + 0.258 * nb * avg + 0.113 * nb * ownB);
  ledgerAdd(s, a, -guess); ledgerAdd(s, b, guess);
  know(s, a, b, pays - guess); know(s, b, a, guess - pays);
  double d = 0.8 * std::fabs(guess) + 20;
  for (int i = 0; i < s.n; i++) if (i != a && i != b) { s.unc[i][a] += d * d; s.unc[i][b] += d * d; }
}
inline void record(Game& s, HistE&& e) { s.hist.push_back(std::move(e)); if (s.hist.size() > 600) { s.hist.erase(s.hist.begin()); s.histCut = true; } }
inline void aucDone(Game& s, int got, int price, bool bought, const vector<int>* cards) {
  const Auction& a = s.au; HistE e; e.t = 'a'; e.k = a.type; e.A = a.auctioneer; e.w = got; e.p = price; e.buy = bought;
  for (int j = 0; j < MAXP; j++) { e.mx[j] = a.mx[j]; e.hasPred[j] = a.hasPred[j]; e.pred[j] = a.pred[j]; e.led[j] = a.led[j]; }
  e.hasLed = a.hasLed;
  if (cards) { e.hasCards = true; e.P = a.payer; e.Q = a.payee; e.m = (int)cards->size(); e.cs = *cards; }
  record(s, std::move(e));
}
inline void khDone(Game& s, const Trade& tr, const vector<int>& ca, const vector<int>* cb, int win) {
  HistE e; e.t = 'k'; e.a = tr.a; e.b = tr.b; e.k = tr.type; e.c = tr.count; e.na = (int)ca.size(); e.nb = cb ? (int)cb->size() : -1; e.win = win;
  e.x = isum(ca); e.y = cb ? isum(*cb) : -1; e.ca = ca; if (cb) e.cb = *cb;
  record(s, std::move(e));
}

struct Target { int p, k, count; bool free; };
inline void targets(const Game& s, int i, vector<Target>& out) {
  out.clear(); const Player& me = s.P[i];
  if (me.out) return;
  for (int j = 0; j < s.n; j++) { if (j == i) continue; const Player& o = s.P[j];
    for (int t = 0; t < NT; t++) if (me.animals[t] && o.animals[t]) out.push_back({j, t, std::min(me.animals[t], o.animals[t]), o.out}); }
}
inline bool hasTargets(const Game& s, int i) {
  const Player& me = s.P[i]; if (me.out) return false;
  for (int j = 0; j < s.n; j++) if (j != i) for (int t = 0; t < NT; t++) if (me.animals[t] && s.P[j].animals[t]) return true;
  return false;
}
struct Score { int sets, score; };
inline Score score(const Player& p, const int* counts) {
  int sets = 0, tot = 0;
  for (int k = 0; k < NT; k++) if (counts[k] && p.animals[k] == counts[k]) { sets++; tot += VAL[k]; }
  return {sets, tot * sets};
}
inline int activeCount(const Game& s) { int c = 0; for (int j = 0; j < s.n; j++) if (!s.P[j].out) c++; return c; }
inline void over(Game& s) { s.hasAuction = s.hasTrade = false; s.phase = PH_OVER; }
inline void advance(Game& s) {
  s.hasAuction = s.hasTrade = false; s.phase = PH_TURN;
  if (activeCount(s) < 2) return over(s);
  // (humans(s): sim players are never bots)
  if (s.deck.empty()) { bool any = false; for (int i = 0; i < s.n && !any; i++) any = hasTargets(s, i); if (!any) return over(s); }
  do s.turn = (s.turn + 1) % s.n; while (s.P[s.turn].out || (s.deck.empty() && !hasTargets(s, s.turn)));
}
inline void closeBidding(Game& s) {
  Auction& a = s.au; Player& au = s.P[a.auctioneer];
  if (!a.hasHigh) { au.animals[a.type]++; aucDone(s, a.auctioneer, 0, false, nullptr); advance(s); }
  else if (au.out) { a.stage = ST_PAY; a.payer = a.highP; a.payee = a.auctioneer; }
  else a.stage = ST_DECIDE;
}
struct Wait { int p; int what; };
inline Wait waiting(const Game& s) {
  if (s.phase == PH_TURN) return {s.turn, W_TURN};
  if (s.phase == PH_AUCTION && s.au.stage == ST_DECIDE) return {s.au.auctioneer, W_DECIDE};
  if (s.phase == PH_AUCTION && s.au.stage == ST_PAY) return {s.au.payer, W_PAY};
  if (s.phase == PH_TRADE) return s.tr.hasBid[s.tr.a] ? Wait{s.tr.b, W_RESPOND} : Wait{s.tr.a, W_OFFER};
  return {-1, W_NONE};
}
inline int waitKey(const Game& s) { Wait w = waiting(s); return w.what == W_NONE ? -1 : w.p * 8 + w.what; }
inline void restartClock(Game& s, long long now) { Wait w = waiting(s); s.due = w.what != W_NONE ? now + LIMIT_MS : 0; }

vector<int> takeCards(const vector<int>& hand, const vector<int>& cards);
void act(Game& s, int pi, const Move& x, long long now, bool forced = false);

inline void autoPay(Game& s, long long now) {
  Auction& a = s.au; Player& pr = s.P[a.payer];
  if (isum(pr.money) >= a.highAmt) { Move m = mvCards(MV_PAY, cheapest(pr.money, a.highAmt)); return act(s, a.payer, m, now, true); }
  s.P[a.auctioneer].animals[a.type]++;
  aucDone(s, a.auctioneer, 0, false, nullptr); advance(s);
}
inline void obvious(Game& s, Wait w, long long now) {
  Player& p = s.P[w.p];
  if (w.what == W_TURN) advance(s);
  else if (w.what == W_DECIDE) act(s, w.p, mvType(isum(p.money) >= s.au.highAmt ? MV_BUY : MV_SELL), now);
  else if (w.what == W_PAY) autoPay(s, now);
  else if (w.what == W_OFFER) act(s, w.p, mvCards(MV_TRADEBID, {}), now);
  else act(s, w.p, mvType(MV_ACCEPT), now);
}
inline void tick(Game& s, long long now) {
  for (int i = 0; i < 400; i++) {
    if (s.phase == PH_AUCTION && s.au.stage == ST_BIDDING) {
      // plannedBid: no bots at a sim table
      if (now < s.au.deadline) break;
      closeBidding(s);
    } else {
      Wait w = waiting(s);
      if (w.what == W_NONE) break;
      if (!(s.due && now >= s.due)) break;
      obvious(s, w, now); // timedOut (strikes and messages are not simulated)
    }
    restartClock(s, now);
  }
}
inline vector<int> takeCards(const vector<int>& hand, const vector<int>& cards) {
  vector<int> h = hand;
  for (int c : cards) { auto it = std::find(h.begin(), h.end(), c); need(it != h.end(), "You do not have those cards"); h.erase(it); }
  return h;
}
inline void resolveTrade(Game& s) {
  Trade& tr = s.tr; Player& A = s.P[tr.a]; Player& B = s.P[tr.b];
  vector<int> ca = tr.bids[tr.a], cb = tr.bids[tr.b];
  int sa = isum(ca), sb = isum(cb);
  if (sa == sb) {
    if (!tr.ties) { tr.ties = 1; tr.hasTieAt = true; tr.tieAt = sa; for (int j = 0; j < MAXP; j++) { tr.hasBid[j] = false; tr.bids[j].clear(); } return; }
    A.animals[tr.type] += tr.count; B.animals[tr.type] -= tr.count;
    khDone(s, tr, ca, &cb, tr.a);
    advance(s); return;
  }
  bool aw = sa > sb; int wi = aw ? tr.a : tr.b, li = aw ? tr.b : tr.a; const vector<int>& cw = aw ? ca : cb; const vector<int>& cl = aw ? cb : ca;
  Player& w = s.P[wi]; Player& l = s.P[li];
  secretDeal(s, tr.a, tr.b, sa - sb, (int)ca.size(), (int)cb.size(), aw);
  vector<int> wm = takeCards(w.money, cw); wm.insert(wm.end(), cl.begin(), cl.end());
  vector<int> lm = takeCards(l.money, cl); lm.insert(lm.end(), cw.begin(), cw.end());
  w.money = std::move(wm); l.money = std::move(lm);
  w.animals[tr.type] += tr.count; l.animals[tr.type] -= tr.count;
  Trade t2 = tr; khDone(s, t2, ca, &cb, wi);
  advance(s);
}
// publicLimits (the plain limit of every bidder from public information) lives with the bots (expert.h)
void publicLimits(Game& s);

inline void act(Game& s, int pi, const Move& x, long long now, bool forced) {
  Player& me = s.P[pi]; int t = x.type;
  need(!me.out || forced, "You are no longer in this game");
  if (s.phase == PH_TURN) {
    need(pi == s.turn, "Not your turn");
    if (t == MV_AUCTION) {
      need(!s.deck.empty(), "The deck is empty");
      int type = s.deck.back(); s.deck.pop_back();
      if (type == MULE) {
        int amt = MULE_PAY[s.mules++];
        HistE e; e.t = 'm'; e.amt = amt;
        for (int i = 0; i < s.n; i++) if (!s.P[i].out) { s.P[i].money.push_back(amt); ledgerAdd(s, i, amt); e.to.push_back(i); }
        record(s, std::move(e));
      }
      s.au = Auction(); s.au.type = type; s.au.auctioneer = pi; s.au.stage = ST_BIDDING; s.au.deadline = now + OPEN_MS; s.hasAuction = true; s.phase = PH_AUCTION;
      s.au.at = now; s.au.nb = 0; // botCaps (no bots)
      publicLimits(s);
      s.au.hasLed = true; for (int j = 0; j < s.n; j++) s.au.led[j] = s.ledger[j];
      return;
    }
    if (t == MV_KOEHANDEL) {
      need(x.target >= 0 && x.target < s.n && x.animal >= 0 && x.animal < NT, "You cannot start a koehandel for that");
      Player& o = s.P[x.target]; int n = std::min(me.animals[x.animal], o.animals[x.animal]);
      bool ok = x.target != pi && !me.out && me.animals[x.animal] && o.animals[x.animal];
      need(ok, "You cannot start a koehandel for that");
      if (o.out) { me.animals[x.animal] += n; o.animals[x.animal] -= n; advance(s); return; }
      s.tr = Trade(); s.tr.a = pi; s.tr.b = x.target; s.tr.type = x.animal; s.tr.count = n; s.hasTrade = true;
      s.khs.push_back({pi, x.target, x.animal}); if (s.khs.size() > 24) s.khs.erase(s.khs.begin());
      s.phase = PH_TRADE;
      return;
    }
  } else if (s.phase == PH_AUCTION) {
    Auction& au = s.au;
    if (au.stage == ST_BIDDING) {
      if (t == MV_BID) {
        need(pi != au.auctioneer, "The auctioneer cannot bid");
        need(!au.hasHigh || au.highP != pi, "You are already the highest bidder");
        int amt = x.amount;
        need(amt % 10 == 0 && amt > (au.hasHigh ? au.highAmt : 0), "Bid higher");
        need(amt <= isum(me.money), "You do not have that much money");
        au.hasHigh = true; au.highP = pi; au.highAmt = amt; au.mx[pi] = amt; au.deadline = now + BID_MS; au.at = now; au.nb++;
        return;
      }
    } else if (au.stage == ST_DECIDE) {
      need(pi == au.auctioneer, "The auctioneer decides");
      if (t == MV_SELL) { au.stage = ST_PAY; au.payer = au.highP; au.payee = pi; return; }
      if (t == MV_BUY) { need(isum(me.money) >= au.highAmt, "You cannot afford that"); au.stage = ST_PAY; au.payer = pi; au.payee = au.highP; return; }
    } else if (au.stage == ST_PAY && t == MV_PAY) {
      need(pi == au.payer, "Not your payment");
      Player& pr = s.P[au.payer]; Player& pe = s.P[au.payee];
      vector<int> rest = takeCards(pr.money, x.cards);
      need(isum(x.cards) >= au.highAmt, "Pay at least the price");
      pr.money = std::move(rest); pe.money.insert(pe.money.end(), x.cards.begin(), x.cards.end()); pr.animals[au.type]++;
      aucDone(s, au.payer, au.highAmt, au.payer == au.auctioneer, &x.cards);
      ledgerAdd(s, au.payer, -au.highAmt); ledgerAdd(s, au.payee, au.highAmt);
      know(s, au.payee, au.payer, au.highAmt - isum(x.cards)); know(s, au.payer, au.payee, isum(x.cards) - au.highAmt);
      advance(s);
      return;
    }
  } else if (s.phase == PH_TRADE && (t == MV_TRADEBID || t == MV_ACCEPT)) {
    Trade& tr = s.tr;
    need(pi == tr.a || pi == tr.b, "You are not in this koehandel");
    need(!tr.hasBid[pi], "You already bid");
    need(pi == tr.a || tr.hasBid[tr.a], "Wait for the offer");
    if (t == MV_ACCEPT) {
      need(pi == tr.b, "Only the defender can accept");
      Player& A = s.P[tr.a]; vector<int> ca = tr.bids[tr.a];
      secretDeal(s, tr.a, pi, isum(ca), (int)ca.size(), 0, true);
      A.money = takeCards(A.money, ca); me.money.insert(me.money.end(), ca.begin(), ca.end());
      A.animals[tr.type] += tr.count; me.animals[tr.type] -= tr.count;
      Trade t2 = tr; khDone(s, t2, ca, nullptr, tr.a);
      advance(s); return;
    }
    takeCards(me.money, x.cards); tr.bids[pi] = x.cards; tr.hasBid[pi] = true;
    if (tr.hasBid[tr.a] && tr.hasBid[tr.b]) resolveTrade(s);
    return;
  }
  throw GameError{"Not allowed right now"};
}
inline void apply(Game& s, int pi, const Move& x, long long now) {
  tick(s, now);
  int before = waitKey(s);
  act(s, pi, x, now);
  if (waitKey(s) != before) restartClock(s, now);
}

// ---------------------------------------------------------------------------------------------------------------
// sim.js
inline void shuffleR(vector<int>& a, Rng& rand) { for (int i = (int)a.size() - 1; i > 0; i--) { int j = (int)std::floor(rand() * (i + 1)); std::swap(a[i], a[j]); } }
inline void composition(int n, Rng& rand, int* out) {
  double ways[NT + 1][4 * NT + 1] = {{0}}; ways[0][0] = 1;
  auto W = [&](int k, int r) { return (r >= 0 && r <= 4 * k) ? ways[k][r] : 0.0; };
  for (int k = 1; k <= NT; k++) for (int r = 0; r <= 4 * k; r++) { double w = 0; for (int c = 2; c <= 4; c++) w = w + W(k - 1, r - c); ways[k][r] = w; }
  int left = n;
  for (int k = NT; k > 0; k--) {
    double x = rand() * W(k, left); int c = 2;
    for (; c < 4; c++) { x -= W(k - 1, left - c); if (x < 0) break; }
    out[NT - k] = c; left -= c;
  }
}
inline void newSimGame(Game& s, int n, int size, Rng& rand) {
  s = Game(); s.n = n; s.deckSize = std::min(40, std::max(20, size));
  // apply(s, 0, start, 0): money, ledger, a clock for the (random, then replaced) first player
  for (int i = 0; i < n; i++) { s.P[i].money.assign(START_MONEY, START_MONEY + 7); s.ledger[i] = isum(s.P[i].money); }
  s.phase = PH_TURN; restartClock(s, 0);
  if (size >= 40) for (int k = 0; k < NT; k++) s.counts[k] = 4; else composition(size, rand, s.counts);
  s.deck.clear(); for (int k = 0; k < NT; k++) for (int c = 0; c < s.counts[k]; c++) s.deck.push_back(k);
  shuffleR(s.deck, rand);
  s.turn = (int)std::floor(rand() * n); s.seed = (int32_t)std::floor(rand() * 2147483648.0);
  s.clock = 1;
}

struct Bid { double cap = 0, open = 0; };
struct Agent {
  virtual ~Agent() {}
  virtual bool hasBid() const { return false; }
  virtual Bid bid(Game& s, int i, Rng& rand) { return {cap(s, i, rand), 0}; }
  virtual double cap(Game& s, int i, Rng& rand) = 0;
  virtual Move act(Game& s, int i, int what, Rng& rand) = 0;
  virtual bool isGang() const { return false; }
  virtual double push(double& sd) const { return 0; } // simulations only: a price-pusher stand-in (th.push), see settleAuction
  virtual bool isPerson() const { return false; } // a stand-in for a person (th.person): the others treat it as one
};
// a log of what happened (for checking against the JS, agent/cpp/movelog.mjs)
struct Logger { virtual void bid(const Game&, int j, const Bid&) {} virtual void move(const Game&, int p, int what, const Move*, const char* err) {} virtual void auction(const Game&) {} };

inline Bid bidOf(Agent* a, Game& s, int j, Rng& rand) { return a->hasBid() ? a->bid(s, j, rand) : Bid{a->cap(s, j, rand), 0}; }
inline void settleAuction(Game& s, Agent** agents, Rng& rand, Logger* L = nullptr) {
  struct C { double c; double r; int j; double open; };
  vector<C> caps;
  int auct = s.au.auctioneer;
  for (int j = 0; j < s.n; j++) {
    if (s.P[j].out || j == auct) continue;
    Bid b = bidOf(agents[j], s, j, rand);
    if (L) L->bid(s, j, b);
    double c = jmin(b.cap, isum(s.P[j].money));
    if (c >= 10) { double r = rand(); caps.push_back({std::floor(c / 10) * 10, r, j, jmin(c, truthy(b.open) ? b.open : 0)}); }
  }
  // th.push (simulations only): a player who has learned how far the others go bids up to push * their highest limit
  // (seen with noise pushSd) minus 10, so that they pay (nearly) their limit; it may win at that price if it guessed high
  double tgt = 0; for (auto& c : caps) { double sd; if (!truthy(agents[c.j]->push(sd)) && c.c > tgt) tgt = c.c; }
  if (tgt >= 20) for (auto& c : caps) {
    double sd = 0, f = agents[c.j]->push(sd); if (!truthy(f)) continue;
    double est = f * tgt * (truthy(sd) ? mexp(sd * std::sqrt(-2 * mlog(1 - rand())) * mcos(6.283185307179586 * rand()) - sd * sd / 2) : 1), m = isum(s.P[c.j].money);
    double p = jmin(m, std::floor(est / 10) * 10 - 10); if (p > c.c) c.c = p;
  }
  std::stable_sort(caps.begin(), caps.end(), [](const C& x, const C& y) { double d = y.c - x.c; if (truthy(d)) return d < 0; return y.r - x.r < 0; });
  double top = 0;
  if (!caps.empty()) top = jmax(caps.size() > 1 ? jmin(caps[0].c, caps[1].c + 10) : 10, std::floor(caps[0].open / 10) * 10);
  double cur = 0;
  for (int x = (int)caps.size() - 1; x >= 1; x--) {
    double amt = jmin(caps[x].c, top - 10);
    if (amt > cur) { Move m; m.type = MV_BID; m.amount = (int)amt; apply(s, caps[x].j, m, s.clock); cur = amt; }
  }
  if (!caps.empty()) { Move m; m.type = MV_BID; m.amount = (int)top; apply(s, caps[0].j, m, s.clock); }
  if (L) L->auction(s);
  s.clock = s.au.deadline; tick(s, s.clock); s.clock++;
}
inline vector<int> playOut(Game& s, Agent** agents, Rng& rand, int maxSteps = 1500, Logger* L = nullptr) {
  for (int step = 0; s.phase != PH_OVER && step < maxSteps; step++) {
    if (s.phase == PH_AUCTION && s.au.stage == ST_BIDDING) { settleAuction(s, agents, rand, L); continue; }
    Wait w = waiting(s);
    if (w.what == W_NONE) break;
    long long t = s.clock++;
    Move mv; bool ok = true;
    try { mv = agents[w.p]->act(s, w.p, w.what, rand); }
    catch (JsThrow& e) { ok = false; s.errors++; s.lastError = e.what; if (L) L->move(s, w.p, w.what, nullptr, e.what); }
    if (ok && L) L->move(s, w.p, w.what, &mv, nullptr);
    try { if (!ok) { tick(s, t); throw GameError{"no move"}; } apply(s, w.p, mv, t); }
    catch (GameError&) { s.due = t; tick(s, t); }
  }
  vector<int> out(s.n);
  for (int j = 0; j < s.n; j++) out[j] = score(s.P[j], s.counts).score;
  return out;
}
inline vector<double> wins(const vector<int>& sc) {
  int best = *std::max_element(sc.begin(), sc.end()), n = 0; for (int x : sc) n += x == best;
  vector<double> out; for (int x : sc) out.push_back(x == best ? 1.0 / n : 0.0);
  return out;
}
}  // namespace kh
