/**
 * In-process Single-Flight Request Coalescer.
 * Ensures that multiple concurrent calls for the exact same key await a single execution promise,
 * preventing redundant external network requests and protecting rate limits.
 */
export class RequestCoalescer {
  private inFlight = new Map<string, Promise<any>>();

  async execute<T>(key: string, fn: () => Promise<T>): Promise<{ result: T; coalesced: boolean }> {
    const existing = this.inFlight.get(key);
    if (existing) {
      const result = await existing;
      return { result, coalesced: true };
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    const result = await promise;
    return { result, coalesced: false };
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.inFlight.clear();
  }
}
