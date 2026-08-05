export type ToastTone = 'info' | 'success' | 'error';

export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  tone: ToastTone;
  message: string;
  description?: string | undefined;
  action?: ToastAction | undefined;
  /** Zprávy se stejným klíčem se neopakují, jen se u nich zvýší počet. */
  dedupeKey?: string | undefined;
};

export type UndoableInput = {
  message: string;
  description?: string | undefined;
  onUndo: () => void;
  dedupeKey?: string | undefined;
  /** Výchozích 10 sekund odpovídá pravidlu 5.4. */
  seconds?: number | undefined;
};

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  // `| undefined` navíc kvůli `exactOptionalPropertyTypes`: vstupy z `ToastInput`
  // mají tahle pole nepovinná, takže nesou `string | undefined`, ne jen `string`.
  description?: string | undefined;
  action?: ToastAction | undefined;
  dedupeKey?: string | undefined;
  count: number;
  undoable: boolean;
  onUndo?: (() => void) | undefined;
  /** null u chyby, která se nikdy nezavře sama. */
  remainingMs: number | null;
  paused: boolean;
};

export type VisibleToast = Toast & { remainingSeconds: number | null };
export type ToastState = { visible: VisibleToast[]; queued: Toast[] };

const MAX_VISIBLE = 3;

/**
 * Běžné potvrzení („2 kontakty jsou teď potvrzené.") je informace, ne úkol.
 * Šest sekund stačí na přečtení dvou řádků i tomu, kdo se zrovna díval jinam,
 * a přitom oznámení nepřekáží déle, než je potřeba.
 */
const INFO_MS = 6000;

/**
 * Okno, ve kterém se dá vratná akce vzít zpět (pravidlo 5.4).
 *
 * Tlačítko „Vrátit zpět" žije jen na oznámení, takže zmizení oznámení JE konec
 * možnosti vrátit. Doba zobrazení se proto odvozuje odsud, ne naopak. Kdyby
 * oznámení zmizelo dřív, člověk by o možnost vrácení tiše přišel a ani by se
 * to nedozvěděl.
 */
const UNDO_WINDOW_MS = 10_000;

const TICK_MS = 250;

export type ToastStore = ReturnType<typeof createToastStore>;

export function createToastStore() {
  let visible: Toast[] = [];
  let queued: Toast[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  // `useSyncExternalStore` porovnává snímek referencí. Snímek se proto
  // dopočítá jednou v `commit()`, ne znovu při každém volání `getState()`,
  // jinak by nová reference při každém vykreslení vyvolala nekonečnou smyčku.
  let snapshot: ToastState = { visible: [], queued: [] };

  // Tikání je líné: běží jen tehdy, když je opravdu co odpočítávat.
  //
  // Není to úspora, ale odolnost. Interval založený jednou při vzniku skladiště
  // se nedal obnovit, a `ToastProvider` ho ve StrictModu zabil hned po připojení
  // (React tam schválně spustí úklid efektů a připojí je znovu). Oznámení pak
  // ve vývojovém režimu nikdy nezmizela, přestože testy skladiště byly zelené.
  // Takhle si `syncTicking()` interval kdykoli vezme zpátky.
  let interval: ReturnType<typeof setInterval> | null = null;

  function commit() {
    snapshot = {
      visible: visible.map((toast) => ({
        ...toast,
        remainingSeconds: toast.remainingMs === null ? null : Math.ceil(toast.remainingMs / 1000),
      })),
      queued: [...queued],
    };
    // Každá změna stavu může tikání rozjet (přibylo oznámení, pokračuje se po
    // najetí myší) i zastavit (poslední oznámení se zavřelo, zbyla jen chyba).
    syncTicking();
    for (const listener of listeners) listener();
  }

  function promote() {
    while (visible.length < MAX_VISIBLE && queued.length > 0) {
      visible.push(queued.shift() as Toast);
    }
  }

  function add(toast: Toast) {
    if (toast.dedupeKey) {
      const existing = [...visible, ...queued].find((item) => item.dedupeKey === toast.dedupeKey);
      if (existing) {
        existing.count += 1;
        existing.remainingMs = toast.remainingMs;
        commit();
        return;
      }
    }
    if (visible.length < MAX_VISIBLE) visible.push(toast);
    else queued.push(toast);
    commit();
  }

  function tick() {
    let changed = false;
    for (const toast of visible) {
      if (toast.remainingMs === null || toast.paused) continue;
      toast.remainingMs -= TICK_MS;
      changed = true;
    }
    const expired = visible.filter((toast) => toast.remainingMs !== null && toast.remainingMs <= 0);
    if (expired.length > 0) {
      visible = visible.filter((toast) => !expired.includes(toast));
      promote();
      changed = true;
    }
    if (changed) commit();
    syncTicking();
  }

  function syncTicking() {
    // Pozastavené oznámení (myš nad ním nebo zaostřené tlačítko „Vrátit zpět")
    // interval zastaví úplně. Po odjetí myši se rozjede znovu od celého tiku,
    // takže najetí myší může život oznámení protáhnout nejvýš o čtvrt sekundy.
    // Delší, ne kratší: pod rukama nesmí zmizet nikdy.
    const ticking = visible.some((toast) => toast.remainingMs !== null && !toast.paused);
    if (ticking && interval === null) interval = setInterval(tick, TICK_MS);
    else if (!ticking && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  return {
    push(input: ToastInput): string {
      sequence += 1;
      const id = `toast-${sequence}`;
      add({
        id,
        tone: input.tone,
        message: input.message,
        description: input.description,
        action: input.action,
        dedupeKey: input.dedupeKey,
        count: 1,
        undoable: false,
        // Chyba zůstane, dokud ji člověk nezavře. Nejde o informaci na odškrtnutí:
        // obvykle po ní následuje nějaká práce (opravit vstup, zkusit znovu),
        // často nese kód pro podporu a čtečka obrazovky ji přečte až po dočtení
        // aktuální věty. Šest sekund by na to nestačilo ani zdaleka.
        remainingMs: input.tone === 'error' ? null : INFO_MS,
        paused: false,
      });
      return id;
    },

    pushUndoable(input: UndoableInput): string {
      sequence += 1;
      const id = `toast-${sequence}`;
      add({
        id,
        tone: 'success',
        message: input.message,
        description: input.description,
        dedupeKey: input.dedupeKey,
        count: 1,
        undoable: true,
        onUndo: input.onUndo,
        // Nikdy kratší než okno pro vrácení. Volající si smí říct o delší dobu
        // (třeba u akce s větším dopadem), o kratší ne: tím by tlačítko
        // „Vrátit zpět" zmizelo dřív, než pravidlo 5.4 slibuje.
        remainingMs: Math.max((input.seconds ?? 0) * 1000, UNDO_WINDOW_MS),
        paused: false,
      });
      return id;
    },

    dismiss(id: string) {
      visible = visible.filter((toast) => toast.id !== id);
      queued = queued.filter((toast) => toast.id !== id);
      promote();
      commit();
    },

    dismissLatest() {
      const latest = visible.at(-1);
      if (latest) this.dismiss(latest.id);
    },

    undoLatest() {
      const latest = [...visible].reverse().find((toast) => toast.undoable);
      if (!latest) return;
      latest.onUndo?.();
      this.dismiss(latest.id);
    },

    pause(id: string) {
      const toast = visible.find((item) => item.id === id);
      if (toast) {
        toast.paused = true;
        commit();
      }
    },

    resume(id: string) {
      const toast = visible.find((item) => item.id === id);
      if (toast) {
        toast.paused = false;
        commit();
      }
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getState(): ToastState {
      return snapshot;
    },

    /**
     * Uklidí po odpojení. Skladiště tím NEUMÍRÁ natrvalo: kdyby po `destroy()`
     * ještě něco přišlo, `syncTicking()` si interval vezme zpátky. Ve StrictModu
     * je přesně tohle běžný stav, protože React tam úklid efektu spustí i po
     * připojení, které pokračuje dál.
     */
    destroy() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      listeners.clear();
    },
  };
}
