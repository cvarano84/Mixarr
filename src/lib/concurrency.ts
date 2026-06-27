export function resolveDbJobConcurrency(value: unknown = process.env.MIXARR_DB_JOB_CONCURRENCY, fallback = 4) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(parsed, 10));
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency = resolveDbJobConcurrency(),
) {
  return mapWithConcurrency(tasks, concurrency, (task) => task());
}
