import { beforeEach, describe, expect, it } from 'vitest';
import { KEYS, Storage } from '../src/storage';
import { ConsentGate } from '../src/consent';

describe('Storage', () => {
  let storage: Storage;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // ODCHYLKA OD PLÁNU: k mazání cookie je potřeba i Expires. happy-dom Max-Age
    // ignoruje a nechal by tu cookie s prázdnou hodnotou.
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;
    storage = new Storage();
  });

  it('bez souhlasu nezapíše nic a anonymous_id neexistuje', () => {
    expect(storage.readAnonymousId()).toBeNull();
    expect(document.cookie).not.toContain(KEYS.anonymousId);
    expect(localStorage.length).toBe(0);
  });

  it('po povolení vytvoří anonymous_id a zapíše ho do cookie i localStorage', () => {
    const id = storage.ensureAnonymousId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(KEYS.anonymousId)).toBe(id);
    expect(document.cookie).toContain(`${KEYS.anonymousId}=${id}`);
  });

  it('localStorage je primární zdroj, cookie jen doplněk', () => {
    localStorage.setItem(KEYS.anonymousId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(storage.readAnonymousId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('když cookie zmizí (Safari ITP), ID se obnoví z localStorage a cookie se dopíše', () => {
    const id = storage.ensureAnonymousId();
    // ODCHYLKA OD PLÁNU: k mazání cookie je potřeba i Expires. happy-dom Max-Age
    // ignoruje a nechal by tu cookie s prázdnou hodnotou.
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;
    expect(storage.ensureAnonymousId()).toBe(id);
    expect(document.cookie).toContain(id);
  });

  it('clear smaže cookie i obě úložiště', () => {
    storage.ensureAnonymousId();
    storage.writeQueue([{ id: 'e1' }]);
    storage.clear();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(KEYS.anonymousId);
  });

  it('nedostupné localStorage (privátní režim) nezpůsobí výjimku', () => {
    // ODCHYLKA OD PLÁNU: test v plánu podvržené localStorage nikdy nevrátil zpátky
    // (vracel jen Storage.prototype.readAnonymousId, což nikdy nepřepsal), takže
    // všechny následující testy v souboru padaly na „zakázáno". Ukládá se a vrací
    // původní deskriptor.
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('zakázáno');
        },
        setItem: () => {
          throw new Error('zakázáno');
        },
        removeItem: () => {},
        clear: () => {},
        length: 0,
      },
      configurable: true,
    });
    expect(() => new Storage().ensureAnonymousId()).not.toThrow();
    if (originalDescriptor !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    }
  });

  it('offline fronta starší než sedm dní se při čtení zahodí', () => {
    const old = Date.now() - 8 * 24 * 3600 * 1000;
    localStorage.setItem(KEYS.queue, JSON.stringify({ at: old, events: [{ id: 'e1' }] }));
    expect(new Storage().readQueue()).toEqual([]);
  });

  it('offline fronta mladší než sedm dní se přehraje', () => {
    const recent = Date.now() - 3600 * 1000;
    localStorage.setItem(KEYS.queue, JSON.stringify({ at: recent, events: [{ id: 'e1' }] }));
    expect(new Storage().readQueue()).toEqual([{ id: 'e1' }]);
  });
});

describe('ConsentGate', () => {
  it('bez souhlasu drží nejvýš dvacet událostí a zahazuje nejstarší', () => {
    const gate = new ConsentGate();
    for (let i = 0; i < 25; i += 1) gate.hold({ id: `e${i}` });
    const released = gate.grant({ analytics: true, personalization: true });
    expect(released).toHaveLength(20);
    expect(released[0]).toEqual({ id: 'e5' });
  });

  it('analytics false znamená, že se nic nepustí', () => {
    const gate = new ConsentGate();
    gate.hold({ id: 'e1' });
    expect(gate.grant({ analytics: false, personalization: false })).toEqual([]);
    expect(gate.isGranted()).toBe(false);
  });

  it('personalization řídí vazbu na kontakt zvlášť od sběru', () => {
    const gate = new ConsentGate();
    gate.grant({ analytics: true, personalization: false });
    expect(gate.isGranted()).toBe(true);
    expect(gate.allowsPersonalization()).toBe(false);
  });

  it('opakované odvolání je idempotentní', () => {
    const gate = new ConsentGate();
    gate.grant({ analytics: true, personalization: true });
    gate.grant({ analytics: false, personalization: false });
    expect(() => gate.grant({ analytics: false, personalization: false })).not.toThrow();
    expect(gate.isGranted()).toBe(false);
  });
});
