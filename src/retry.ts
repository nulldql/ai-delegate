export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; isRetryable: (err: unknown) => boolean },
): Promise<T> {
  const retries = opts.retries ?? 3;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!opts.isRetryable(err) || attempt >= retries) throw err;
      const delayMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}
