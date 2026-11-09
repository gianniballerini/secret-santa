export interface Pair<T> {
  giver: T;
  recipient: T;
}

function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Draws a derangement: every item gives to exactly one other item and receives
 * from exactly one other item; nobody gets themselves.
 * Reshuffles until there are no fixed points (expected ~e attempts).
 */
export function draw<T>(items: readonly T[]): Pair<T>[] {
  if (items.length < 3) {
    throw new Error('Se necesitan al menos 3 participantes para sortear.');
  }
  let shuffled: T[];
  do {
    shuffled = shuffle(items);
  } while (shuffled.some((r, i) => r === items[i]));
  return items.map((giver, i) => ({ giver, recipient: shuffled[i]! }));
}
