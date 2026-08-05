import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastStore } from './toast-store';

describe('createToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T14:00:00.000Z'));
  });

  it('zobrazuje nejvýš tři naráz, další čekají ve frontě', () => {
    const store = createToastStore();
    for (let index = 0; index < 5; index += 1) {
      store.push({ tone: 'info', message: `Zpráva ${index}` });
    }
    expect(store.getState().visible).toHaveLength(3);
    expect(store.getState().queued).toHaveLength(2);
  });

  it('stejnou zprávu neopakuje, jen zvýší počet', () => {
    const store = createToastStore();
    for (let index = 0; index < 4; index += 1) {
      store.push({ tone: 'info', message: 'Kontakt odebrán', dedupeKey: 'contact-removed' });
    }
    const visible = store.getState().visible;
    expect(visible).toHaveLength(1);
    expect(visible[0]!.count).toBe(4);
  });

  it('informace mizí po 6 sekundách', () => {
    const store = createToastStore();
    store.push({ tone: 'info', message: 'Uloženo' });
    vi.advanceTimersByTime(5999);
    expect(store.getState().visible).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('chyba se nikdy nezavře sama, ani po 30 sekundách', () => {
    const store = createToastStore();
    store.push({ tone: 'error', message: 'Kontakt se nepodařilo odebrat.' });
    vi.advanceTimersByTime(30_000);
    expect(store.getState().visible).toHaveLength(1);
  });

  it('vratná akce žije 10 sekund a odpočet je čitelný', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Segment Neaktivní smazán', onUndo: () => {} });
    expect(store.getState().visible[0]!.remainingSeconds).toBe(10);
    vi.advanceTimersByTime(3000);
    expect(store.getState().visible[0]!.remainingSeconds).toBe(7);
    vi.advanceTimersByTime(7001);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('pozastavení zastaví odpočet a pokračování ho rozjede', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Štítek odebrán', onUndo: () => {} });
    const id = store.getState().visible[0]!.id;
    vi.advanceTimersByTime(2000);
    store.pause(id);
    vi.advanceTimersByTime(20_000);
    expect(store.getState().visible).toHaveLength(1);
    expect(store.getState().visible[0]!.remainingSeconds).toBe(8);
    store.resume(id);
    vi.advanceTimersByTime(8001);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('vratná akce se nezkrátí pod okno pro vrácení, i když si o to volající řekne', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Štítek přidán', onUndo: () => {}, seconds: 3 });
    vi.advanceTimersByTime(3500);
    // Tlačítko „Vrátit zpět" žije jen na oznámení. Kdyby zmizelo po třech
    // sekundách, člověk by o možnost vrácení přišel dřív, než pravidlo slibuje.
    expect(store.getState().visible).toHaveLength(1);
    vi.advanceTimersByTime(6501);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('delší dobu si volající vyžádat smí', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Kampaň zastavena', onUndo: () => {}, seconds: 30 });
    vi.advanceTimersByTime(20_000);
    expect(store.getState().visible[0]!.remainingSeconds).toBe(10);
  });

  it('odpočet se rozjede znovu i po destroy, jinak by StrictMode skladiště umlčel', () => {
    const store = createToastStore();
    // React ve StrictModu spustí úklid efektu i po připojení, které pokračuje.
    // `ToastProvider` v tu chvíli zavolá `destroy()`, aniž by skončil.
    store.destroy();
    store.push({ tone: 'info', message: 'Uloženo' });
    vi.advanceTimersByTime(6001);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('vrácení akce zavolá obsluhu a toast zmizí', () => {
    const store = createToastStore();
    const onUndo = vi.fn();
    store.pushUndoable({ message: 'Kontakt odebrán ze seznamu', onUndo });
    store.undoLatest();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('undoLatest vrátí jen nejnovější vratnou akci, chyby přeskočí', () => {
    const store = createToastStore();
    const first = vi.fn();
    const second = vi.fn();
    store.pushUndoable({ message: 'První', onUndo: first });
    store.pushUndoable({ message: 'Druhá', onUndo: second });
    store.push({ tone: 'error', message: 'Chyba' });
    store.undoLatest();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('zavření nejnovějšího uvolní místo pro čekající', () => {
    const store = createToastStore();
    for (let index = 0; index < 4; index += 1) {
      store.push({ tone: 'error', message: `Chyba ${index}` });
    }
    expect(store.getState().queued).toHaveLength(1);
    store.dismissLatest();
    expect(store.getState().visible).toHaveLength(3);
    expect(store.getState().queued).toHaveLength(0);
  });
});
