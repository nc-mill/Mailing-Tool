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
const INFO_MS = 6000;
const UNDO_MS = 10_000;
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

  function commit() {
    snapshot = {
      visible: visible.map((toast) => ({
        ...toast,
        remainingSeconds: toast.remainingMs === null ? null : Math.ceil(toast.remainingMs / 1000),
      })),
      queued: [...queued],
    };
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

  const interval = setInterval(() => {
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
  }, TICK_MS);

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
        // Chyba se nikdy nezavírá sama, uživatel se v tu chvíli mohl dívat jinam.
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
        remainingMs: (input.seconds ?? UNDO_MS / 1000) * 1000,
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

    destroy() {
      clearInterval(interval);
      listeners.clear();
    },
  };
}
