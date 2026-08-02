export type Tile<T> =
  { status: 'ok'; data: T; computedAt: string; stale: boolean } | { status: 'error'; code: string };

type Entry = { value: unknown; computedAt: number };

/**
 * Cache dlaždic přehledu, jedna instance na proces. Klíčem je dvojice
 * projektu a období, takže se nikdy nesmíchají data dvou projektů.
 *
 * Dvě pravidla, na kterých stojí poctivost obrazovky:
 * 1. Když se přepočet nepovede a stará hodnota existuje, vrátí se stará
 *    hodnota označená jako zastaralá. Prázdná dlaždice je horší.
 * 2. Když stará hodnota není, dlaždice přizná chybu a zbytek stránky žije dál.
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();

  async resolve<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<Tile<T>> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && now - cached.computedAt < ttlMs) {
      return {
        status: 'ok',
        data: cached.value as T,
        computedAt: new Date(cached.computedAt).toISOString(),
        stale: false,
      };
    }

    try {
      const value = await compute();
      this.entries.set(key, { value, computedAt: now });
      return { status: 'ok', data: value, computedAt: new Date(now).toISOString(), stale: false };
    } catch {
      if (!cached) return { status: 'error', code: 'tile_unavailable' };
      return {
        status: 'ok',
        data: cached.value as T,
        computedAt: new Date(cached.computedAt).toISOString(),
        stale: true,
      };
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
