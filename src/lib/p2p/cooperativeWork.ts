/** One shared budget across peers; macrotask yields let rendering and media run. */
export const SYNC_SLICE_MS = 4;
export const SYNC_STEPS_PER_SLICE = 32;
export const SYNC_YIELD_MS = 16;

type Job = { step: () => boolean };
const jobs: Job[] = [];
let scheduled = false;

function schedule(): void {
  if (scheduled || !jobs.length) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const started = performance.now();
    let steps = 0;
    do {
      const job = jobs.shift();
      if (!job) break;
      if (job.step()) jobs.push(job);
      steps++;
    } while (jobs.length && steps < SYNC_STEPS_PER_SLICE && performance.now() - started < SYNC_SLICE_MS);
    schedule();
  }, SYNC_YIELD_MS);
}

/** No idle starvation or Brain pause; cancellation stops stale channel work. */
export function runCooperatively<T>(work: Generator<unknown, T, unknown>, active: () => boolean = () => true): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    jobs.push({ step: () => {
      try {
        if (!active()) { work.return(undefined as T); resolve(undefined); return false; }
        const next = work.next();
        if (next.done) { resolve(next.value); return false; }
        return true;
      } catch (error) { reject(error); return false; }
    } });
    schedule();
  });
}

/** Plain snapshot JSON, traversed one field at a time instead of one big stringify. */
export function* stringifySteps(value: unknown): Generator<void, string, unknown> {
  const pieces: string[] = [];
  const ancestors = new Set<object>();
  function* visit(input: unknown): Generator<void, void, unknown> {
    if (input === null || typeof input !== 'object') {
      pieces.push(JSON.stringify(input) ?? 'null');
      yield;
      return;
    }
    if (ancestors.has(input)) throw new TypeError('Cyclic snapshot');
    ancestors.add(input);
    const array = Array.isArray(input);
    pieces.push(array ? '[' : '{');
    let first = true;
    if (array) {
      for (let i = 0; i < input.length; i++) {
        if (!first) pieces.push(',');
        first = false;
        yield* visit(input[i]);
      }
    } else {
      for (const key in input) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const child = (input as Record<string, unknown>)[key];
        if (child === undefined || typeof child === 'function' || typeof child === 'symbol') { yield; continue; }
        if (!first) pieces.push(',');
        first = false;
        pieces.push(JSON.stringify(key), ':');
        yield* visit(child);
      }
    }
    pieces.push(array ? ']' : '}');
    ancestors.delete(input);
    yield;
  }
  yield* visit(value);
  return pieces.join('');
}

export const stringifyCooperatively = (value: unknown, active?: () => boolean) => runCooperatively(stringifySteps(value), active);