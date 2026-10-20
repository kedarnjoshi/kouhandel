// Constants and helpers shared by the game engine, the bots and the page.
export const ANIMALS = { horse:1000, cow:800, pig:650, mule:500, goat:350, sheep:250, dog:160, cat:90, duck:40, chicken:10 };
export const TYPES = Object.keys(ANIMALS);
export const START_MONEY = [0, 0, 10, 10, 10, 10, 50];
export const MULE_PAY = [50, 100, 200, 500]; // everyone receives this when the 1st, 2nd, 3rd and 4th money mule comes up
export const sum = a => a.reduce((x, y) => x + y, 0);
// Cards worth at least amt with the least overpayment (then the fewest cards).
export function cheapest(hand, amt) {
  const best = new Map([[0, []]]);
  for (const c of hand) for (const [v, cs] of [...best]) { const cur = best.get(v + c); if (!cur || cur.length > cs.length + 1) best.set(v + c, [...cs, c]); }
  let pick = null;
  for (const [v, cs] of best) if (v >= amt && (!pick || v < pick[0] || (v === pick[0] && cs.length < pick[1].length))) pick = [v, cs];
  return pick ? pick[1] : [...hand];
}
