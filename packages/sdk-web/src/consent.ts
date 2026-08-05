export type ConsentState = {
  /** Podmínka pro jakýkoliv sběr. */
  analytics: boolean;
  /** Podmínka pro vazbu na kontakt. */
  personalization: boolean;
  /** SDK jen předává dál, sám ho nepoužívá. */
  emailMarketing?: boolean | undefined;
};

const MAX_HELD_EVENTS = 20;

/**
 * Souhlas je vstupní podmínka, ne dodatečný filtr.
 * Dokud není udělený, nic se neuloží do prohlížeče a neexistuje anonymous_id.
 */
export class ConsentGate {
  #state: ConsentState | null = null;
  #held: unknown[] = [];

  isGranted(): boolean {
    return this.#state?.analytics === true;
  }

  allowsPersonalization(): boolean {
    return this.#state?.analytics === true && this.#state.personalization === true;
  }

  /** Před souhlasem se události drží jen v paměti. */
  hold(event: unknown): void {
    this.#held.push(event);
    if (this.#held.length > MAX_HELD_EVENTS) this.#held.shift();
  }

  /** Vrátí frontu k přehrání. Při odvolání vrátí prázdné pole a frontu zahodí. */
  grant(state: ConsentState): unknown[] {
    this.#state = state;
    if (!state.analytics) {
      this.#held = [];
      return [];
    }
    const released = this.#held;
    this.#held = [];
    return released;
  }
}
