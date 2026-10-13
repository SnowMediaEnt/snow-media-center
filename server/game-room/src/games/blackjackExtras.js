// Profit odds; returned stake is added exactly once for a winning side bet.
export const SIDE_BETS = ['pairs', 'three', 'ladies'];
export function validateSideBets(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some(key => !SIDE_BETS.includes(key))) return null;
  const result = {};
  for (const key of SIDE_BETS) {
    const value = input[key] ?? 0;
    if (!Number.isSafeInteger(value) || ![0, 10, 25, 50, 100].includes(value)) return null;
    result[key] = value;
  }
  return result;
}
export function evaluateSideBets(player, dealer, wagers) {
  const [a, b] = player;
  const rank = c => '23456789TJQKA'.indexOf(c.rank === '10' ? 'T' : c.rank) + 2;
  const value = c => c.rank === 'A' ? 11 : Math.min(10, rank(c));
  const red = c => ['H', 'D'].includes(c.suit);
  const suited = a.suit === b.suit;
  let pairs = 0;
  if (a.rank === b.rank) pairs = suited ? 25 : red(a) === red(b) ? 12 : 6;
  const cards = [a, b, dealer[0]];
  const ranks = cards.map(rank).sort((x, y) => x - y);
  const flush = cards.every(c => c.suit === a.suit);
  const trips = ranks[0] === ranks[2];
  const straight = new Set(ranks).size === 3 && (ranks[2] - ranks[0] === 2 || ranks.join(',') === '2,3,14');
  const three = trips && flush ? 100 : straight && flush ? 40 : trips ? 30 : straight ? 10 : flush ? 5 : 0;
  let ladies = 0;
  if (value(a) + value(b) === 20) {
    const queens = a.rank === 'Q' && b.rank === 'Q' && a.suit === 'H' && b.suit === 'H';
    const dealerBJ = dealer.length === 2 && value(dealer[0]) + value(dealer[1]) === 21;
    ladies = queens ? (dealerBJ ? 1000 : 200) : suited && a.rank === b.rank ? 25 : suited ? 10 : 4;
  }
  return Object.entries({ pairs, three, ladies }).map(([key, odds]) => ({
    key, bet: wagers[key], odds, payout: odds > 0 ? wagers[key] * (odds + 1) : 0,
  })).filter(result => result.bet > 0);
}
