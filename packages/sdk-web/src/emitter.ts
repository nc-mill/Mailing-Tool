export type SdkEventName = 'ready' | 'identified' | 'error' | 'blocked';

/** SDK nikdy nevyhodí neodchycenou výjimku do stránky zákazníka. */
export class Emitter {
  readonly #handlers = new Map<SdkEventName, ((payload: unknown) => void)[]>();

  on(event: SdkEventName, handler: (payload: unknown) => void): () => void {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
    return () => {
      const current = this.#handlers.get(event) ?? [];
      const index = current.indexOf(handler);
      if (index !== -1) current.splice(index, 1);
    };
  }

  emit(event: SdkEventName, payload?: unknown): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch {
        // Chyba v handleru zákazníka nesmí zastavit sběr.
      }
    }
  }
}
