export type PageProperties = {
  title?: string | undefined;
  path?: string | undefined;
  url?: string | undefined;
  referrer?: string | undefined;
  [key: string]: unknown;
};

const DEDUP_WINDOW_MS = 1000;

export class PageTracker {
  #lastPath = '';
  #lastAt = 0;

  /** SPA routery volají replaceState opakovaně, proto deduplikace na jednu sekundu. */
  shouldEmit(path: string, now: number): boolean {
    if (path === this.#lastPath && now - this.#lastAt < DEDUP_WINDOW_MS) return false;
    this.#lastPath = path;
    this.#lastAt = now;
    return true;
  }

  /** Čte se jen adresa a titulek. Formulářová pole se nečtou nikdy. */
  describe(overrides: PageProperties = {}): Record<string, unknown> {
    return {
      url: overrides.url ?? window.location.href,
      path: overrides.path ?? window.location.pathname,
      title: overrides.title ?? document.title,
      referrer: overrides.referrer ?? document.referrer,
      search: window.location.search,
    };
  }

  observe(onChange: () => void): void {
    const wrap = (name: 'pushState' | 'replaceState'): void => {
      const original = history[name].bind(history);
      history[name] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const result = original(...args);
        onChange();
        return result;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', onChange);
  }
}
