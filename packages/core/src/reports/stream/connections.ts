export type ReleaseFn = () => void;

/**
 * Stropy z 3.13.3 části 5: nejvýš dvě spojení na relaci a nejvýš
 * TRACKING_SSE_MAX_CONNECTIONS na instanci. Nad limit se vrací 503
 * a klient přejde na dotazování, což je plnohodnotný režim, ne degradace.
 */
export class ConnectionLimiter {
  private total = 0;
  private readonly perSession = new Map<string, number>();

  constructor(private readonly limits: { maxTotal: number; maxPerSession: number }) {}

  get count(): number {
    return this.total;
  }

  acquire(sessionKey: string): ReleaseFn | null {
    const used = this.perSession.get(sessionKey) ?? 0;
    if (this.total >= this.limits.maxTotal) return null;
    if (used >= this.limits.maxPerSession) return null;

    this.total += 1;
    this.perSession.set(sessionKey, used + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      const current = this.perSession.get(sessionKey) ?? 1;
      if (current <= 1) this.perSession.delete(sessionKey);
      else this.perSession.set(sessionKey, current - 1);
    };
  }
}
