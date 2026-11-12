export interface Pair<T> {
  giver: T;
  recipient: T;
}

/** No assignment satisfies the rules (for example, one group holds more than half of everyone). */
export class DrawImpossibleError extends Error {
  constructor() {
    super('No hay forma de sortear con estos grupos. Probá con grupos más chicos o sumá más gente.');
    this.name = 'DrawImpossibleError';
  }
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
 * from exactly one other item; nobody gets themselves, and no giver gets a
 * recipient that `forbidden` rejects.
 * Randomized backtracking: each giver tries the free recipients in a fresh random
 * order, so impossible rules end in DrawImpossibleError instead of looping forever.
 */
export function draw<T>(
  items: readonly T[],
  forbidden: (giver: T, recipient: T) => boolean = () => false,
): Pair<T>[] {
  if (items.length < 3) {
    throw new Error('Se necesitan al menos 3 participantes para sortear.');
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = search(items, forbidden);
    if (result === 'impossible') break;
    if (result) return result;
  }
  throw new DrawImpossibleError();
}

/** Each search gives up after this many steps and restarts with a new random order. */
const STEP_BUDGET = 20_000;
const MAX_ATTEMPTS = 10;

/** One randomized search: a draw, 'impossible' when it explored every option, or null when it ran out of steps. */
function search<T>(
  items: readonly T[],
  forbidden: (giver: T, recipient: T) => boolean,
): Pair<T>[] | 'impossible' | null {
  // Givers are assigned in a random order too, so no position is favoured.
  const order = shuffle(items.map((_, i) => i));
  const recipientOf: number[] = new Array(items.length);
  const used = new Array<boolean>(items.length).fill(false);
  let steps = 0;
  let exhausted = true;

  const assign = (step: number): boolean => {
    if (step === order.length) return true;
    const g = order[step]!;
    for (const r of shuffle(order)) {
      if (r === g || used[r] || forbidden(items[g]!, items[r]!)) continue;
      if (++steps > STEP_BUDGET) {
        exhausted = false;
        return false;
      }
      used[r] = true;
      recipientOf[g] = r;
      if (assign(step + 1)) return true;
      used[r] = false;
      if (!exhausted) return false;
    }
    return false;
  };

  if (assign(0)) return items.map((giver, i) => ({ giver, recipient: items[recipientOf[i]!]! }));
  return exhausted ? 'impossible' : null;
}
