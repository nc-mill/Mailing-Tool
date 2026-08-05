import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFilename, useImportUpload } from './use-import-upload';

/**
 * Nahrání souboru s DIAKRITIKOU V NÁZVU. Přesně na tom celý import padal:
 * `setRequestHeader` hodí synchronně `TypeError: String contains non
 * ISO-8859-1 code point`, výjimka letěla z obsluhy výběru souboru, `send()`
 * se nikdy nespustil a na obrazovce se nestalo VŮBEC NIC. Uživatel vybral
 * soubor a čekal.
 *
 * Náhrada za XMLHttpRequest proto tu kontrolu dělá stejně jako prohlížeč:
 * hodnota hlavičky musí projít Latin-1, jinak hází. Bez toho by test prošel
 * i s vadným kódem, protože jsdom si na hlavičky nestěžuje.
 */
class FakeXhr {
  static last: FakeXhr | null = null;
  readonly headers: Record<string, string> = {};
  status = 202;
  responseText = JSON.stringify({ id: '9855e936-c11a-4b3d-b799-33a53178916c' });
  sent = false;
  upload = { addEventListener: vi.fn() };
  private listeners: Record<string, () => void> = {};

  constructor() {
    FakeXhr.last = this;
  }

  open(): void {}

  setRequestHeader(name: string, value: string): void {
    if (!isLatin1(value)) {
      throw new TypeError(
        `Failed to execute 'setRequestHeader' on 'XMLHttpRequest': String contains non ISO-8859-1 code point.`,
      );
    }
    this.headers[name] = value;
  }

  addEventListener(event: string, handler: () => void): void {
    this.listeners[event] = handler;
  }

  send(): void {
    this.sent = true;
    this.listeners['load']?.();
  }

  abort(): void {}
}

/** Co unese hlavička HTTP: jen znaky do U+00FF. Prohlížeč na zbytku hází. */
function isLatin1(value: string): boolean {
  return [...value].every((char) => (char.codePointAt(0) ?? 0) <= 0xff);
}

function fileNamed(name: string): File {
  return new File(['email\njana@firma.cz\n'], name, { type: 'text/csv' });
}

function setup() {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-3333-4444-555555555555' });
  return renderHook(() =>
    useImportUpload({
      workspaceId: '019fbf52-d8b9-7b0d-b67e-528e8026a383',
      maxBytes: 1_000_000,
      accept: '.csv,text/csv',
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe('nahrání souboru', () => {
  it('odešle soubor s diakritikou v názvu, místo aby se tiše zastavilo', async () => {
    const { result } = setup();

    act(() => result.current.upload(fileNamed('kontakty-červen.csv')));

    expect(FakeXhr.last?.sent).toBe(true);
    // Server dostane jméno v podobě, ze které ho umí složit zpátky.
    expect(FakeXhr.last?.headers['X-Filename']).toBe('kontakty-%C4%8Derven.csv');
    expect(decodeURIComponent(FakeXhr.last?.headers['X-Filename'] ?? '')).toBe(
      'kontakty-červen.csv',
    );
    await waitFor(() => expect(result.current.state.phase).toBe('done'));
  });

  it('ohlásí selhání přípravy požadavku místo ticha', async () => {
    const { result } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(FakeXhr.prototype, 'send').mockImplementation(() => {
      throw new TypeError('network stack refused');
    });

    act(() => result.current.upload(fileNamed('kontakty.csv')));

    // Žádné zaseknutí na „nahrávám": stav je chybový a nese technický detail.
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    expect(result.current.state).toMatchObject({ code: 'upload_failed' });
  });
});

describe('encodeFilename', () => {
  it('projde přes Latin-1, tedy přes to, co hlavička unese', () => {
    const encoded = encodeFilename('kontakty-červen.csv');
    expect(isLatin1(encoded)).toBe(true);
    expect(decodeURIComponent(encoded)).toBe('kontakty-červen.csv');
  });

  it('nechá název bez diakritiky beze změny', () => {
    expect(encodeFilename('contacts.csv')).toBe('contacts.csv');
  });
});
