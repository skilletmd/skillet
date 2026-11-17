/**
 * `work` over every item, at most `limit` at a time, with each result at its
 * item's index: the order the items came in, whatever order the work ends in.
 * Work starts in that order too. A rejection rejects the whole call.
 */
export async function mapInOrder<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, lane));
  return results;
}
