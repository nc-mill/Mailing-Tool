import type { ReactNode } from 'react';
import { TooltipProvider } from '@mlain/ui/components/tooltip';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csEditor from '@mlain/i18n/messages/cs/editor.json';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import type { EditorDocument } from '../../model/document-types';
import { EditorHeader } from './editor-header';

/**
 * Ukládání je jediná věc, kterou uživatel v editoru NESMÍ ztratit z dohledu.
 *
 * Vada, kvůli které tenhle soubor vznikl: automatické ukládání se po vložení
 * návrhu od AI vůbec nespustilo, hlavička proto zůstala prázdná a v UI nebylo
 * nic, čím uložit ručně. Uživatel přišel o práci a neměl jak to poznat.
 */
const doc = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: 'P', language: 'cs' },
    theme: {},
    blocks: [],
  }) as unknown as EditorDocument;

// Zkušební odeslání je ikonové tlačítko v bublině, a `Tooltip` mimo
// `TooltipProvider` vyhodí výjimku. V aplikaci ho dodává skořápka.
const wrap = (ui: ReactNode, store: ReturnType<typeof createEditorStore>) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: csEditor }} timeZone="Europe/Prague">
      <TooltipProvider>
        <EditorStoreProvider value={store}>{ui}</EditorStoreProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );

const header = (
  store: ReturnType<typeof createEditorStore>,
  onSave = vi.fn(),
  readOnly = false,
) => {
  wrap(
    <EditorHeader
      mode="edit"
      onMode={vi.fn()}
      onTestSend={vi.fn()}
      onSave={onSave}
      readOnly={readOnly}
    />,
    store,
  );
  return onSave;
};

/**
 * AKCE VPRAVO V HLAVIČCE: Náhled slovem, zkušební odeslání ikonou.
 *
 * Hlavička se lámala do dvou řádků, protože vlevo stojí čtyři režimy zobrazení
 * a vpravo byla tři textová tlačítka. Zkušební odeslání se proto 6. 8. 2026
 * smrsklo na ikonu s obálkou. Náhled zůstává SLOVEM: přepíná celou obrazovku
 * a oko se na jedné obrazovce používá i pro „ukázat heslo" a „viditelný
 * sloupec", takže se z něj nepozná, co se stane.
 *
 * Jméno akce se u obojího čte stejně: e2e i čtečka ho berou jako přístupné
 * jméno tlačítka, ať už je uvnitř textem, nebo v `aria-label`.
 */
describe('akce v hlavičce editoru', () => {
  const both = (mode: 'edit' | 'preview') => {
    const onMode = vi.fn();
    const onTestSend = vi.fn();
    wrap(
      <EditorHeader
        mode={mode}
        onMode={onMode}
        onTestSend={onTestSend}
        onSave={vi.fn()}
        readOnly={false}
      />,
      createEditorStore({ document: doc(), designHash: 'h1' }),
    );
    return { onMode, onTestSend };
  };

  it('Náhled i Poslat test zůstávají dohledatelné podle jména akce', () => {
    both('edit');
    expect(screen.getByRole('button', { name: 'Náhled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poslat test' })).toBeInTheDocument();
  });

  it('Náhled je vidět jako text, ne jen jako přístupné jméno', () => {
    both('edit');
    expect(screen.getByTestId('editor-preview')).toHaveTextContent('Náhled');
  });

  it('jméno akce je i v `title`, takže bublinu ukáže i prohlížeč sám', () => {
    both('edit');
    expect(screen.getByRole('button', { name: 'Poslat test' })).toHaveAttribute(
      'title',
      'Poslat test',
    );
  });

  it('klikací plocha zůstává 44 px u obou', () => {
    both('edit');
    // Textové tlačítko si drží výšku (`min-h-`), ikonové celou stranu čtverce
    // (`size-`). Naměřená hodnota je u obou táž proměnná.
    expect(screen.getByTestId('editor-preview')).toHaveClass('min-h-[var(--size-target-min)]');
    expect(screen.getByTestId('editor-test-send')).toHaveClass('size-[var(--size-target-min)]');
  });

  /*
   * NÁHLED A POSLAT TEST MAJÍ STEJNOU VÁHU.
   *
   * Vada, kvůli které to tvrzení vzniklo: náhled dostal tichou variantu
   * ikonového tlačítka (průhledný rámeček, tlumený text) a zkušební odeslání
   * plnou. Vedle sebe to vypadalo, že je náhled zakázaný, i když zakázaný
   * nebyl. Obě podoby proto kreslí rámeček `border-edge` a spodní hranu.
   */
  it('Náhled nevypadá zakázaně vedle Poslat test: obojí má rámeček v barvě hrany', () => {
    both('edit');
    expect(screen.getByTestId('editor-preview')).toHaveClass('border-edge');
    expect(screen.getByTestId('editor-test-send')).toHaveClass('border-edge');
  });

  it('Náhled není vypnutý', () => {
    both('edit');
    expect(screen.getByTestId('editor-preview')).toBeEnabled();
  });

  /*
   * NÁHLED JE PŘEPÍNAČ SE STÁLÝM JMÉNEM.
   *
   * Dřív se tu tvrdilo, že se popisek v náhledu mění na „Zpět k úpravám".
   * Změněno 6. 8. 2026 na pokyn zadavatele: delší nápis lámal hlavičku
   * v náhledu do dvou řádků, přestože v úpravách držela jeden. Tvrzení
   * o přepínání zůstává, jen se stav čte z `aria-pressed` místo z textu,
   * jak to pro přepínací tlačítko popisuje WAI-ARIA. Že je tlačítko pořád
   * jedno a totéž a že přepíná obojím směrem, se tvrdí dál.
   */
  it('v náhledu se tlačítko jmenuje pořád Náhled a hlásí se jako stisknuté', () => {
    both('preview');
    const toggle = screen.getByRole('button', { name: 'Náhled' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('v úpravách je tentýž přepínač nestisknutý', () => {
    both('edit');
    expect(screen.getByRole('button', { name: 'Náhled' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('stisknutý stav není nesený jen barvou textu: mění se plocha tlačítka', () => {
    both('preview');
    expect(screen.getByTestId('editor-preview')).toHaveClass('aria-pressed:bg-accent-surface');
  });

  it('z úprav přepne do náhledu', () => {
    const { onMode } = both('edit');
    screen.getByTestId('editor-preview').click();
    expect(onMode).toHaveBeenCalledWith('preview');
  });

  it('z náhledu přepne zpátky do úprav, i když se popisek nezměnil', () => {
    const { onMode } = both('preview');
    screen.getByTestId('editor-preview').click();
    expect(onMode).toHaveBeenCalledWith('edit');
  });

  it('Poslat test jen ohlásí akci: dialog otevírá skořápka, neodesílá se hned', () => {
    const { onTestSend } = both('edit');
    screen.getByRole('button', { name: 'Poslat test' }).click();
    expect(onTestSend).toHaveBeenCalledTimes(1);
  });
});

/**
 * POŘADÍ V KÓDU = POŘADÍ NA OBRAZOVCE = POŘADÍ TABULÁTOREM.
 *
 * „Pokračovat" se přesunulo z prvního místa na poslední, tedy úplně doprava.
 * Přesouvat ho vizuálně přes CSS (`order`, `row-reverse`) by znamenalo, že
 * tabulátor a čtečka jdou hlavičkou jinudy než oko, proto se tvrdí pořadí
 * v DOM: to je zároveň pořadí fokusu, protože žádné `tabindex` v hlavičce není.
 */
describe('pořadí akcí v hlavičce', () => {
  it('Uložit, Náhled, Poslat test a nakonec Pokračovat', () => {
    wrap(
      <EditorHeader
        mode="edit"
        onMode={vi.fn()}
        onTestSend={vi.fn()}
        onSave={vi.fn()}
        readOnly={false}
        returnTo={{ href: '/dal', label: 'Pokračovat', campaignId: 'c1' }}
        onReturn={vi.fn()}
      />,
      createEditorStore({ document: doc(), designHash: 'h1' }),
    );

    const group = screen.getByTestId('editor-preview').parentElement;
    const names = [...(group?.querySelectorAll('button') ?? [])].map((button) =>
      (button.textContent || button.getAttribute('aria-label') || '').trim(),
    );
    expect(names).toEqual(['Uložit', 'Náhled', 'Poslat test', 'Pokračovat']);
  });

  it('u samostatné šablony žádné Pokračovat není a poslední zůstává Poslat test', () => {
    wrap(
      <EditorHeader
        mode="edit"
        onMode={vi.fn()}
        onTestSend={vi.fn()}
        onSave={vi.fn()}
        readOnly={false}
      />,
      createEditorStore({ document: doc(), designHash: 'h1' }),
    );

    expect(screen.queryByTestId('editor-return')).toBeNull();
    const group = screen.getByTestId('editor-preview').parentElement;
    const buttons = [...(group?.querySelectorAll('button') ?? [])];
    expect(buttons[buttons.length - 1]).toBe(screen.getByTestId('editor-test-send'));
  });

  /*
   * STAV UKLÁDÁNÍ STOJÍ TĚSNĚ PŘED TLAČÍTKEM ULOŽIT.
   *
   * Dřív byl v levé skupině mezi názvem a ovladači zobrazení, tedy přes půl
   * hlavičky od tlačítka, se kterým mluví o téže věci. Tvrdí se sousedství
   * v DOM, ne souřadnice: pořadí v kódu je zároveň pořadí na obrazovce
   * i pořadí čtečkou, protože skupina nemá ani `order`, ani `row-reverse`.
   */
  it('stav ukládání je v téže skupině jako Uložit a stojí hned před ním', () => {
    wrap(
      <EditorHeader
        mode="edit"
        onMode={vi.fn()}
        onTestSend={vi.fn()}
        onSave={vi.fn()}
        readOnly={false}
      />,
      createEditorStore({ document: doc(), designHash: 'h1' }),
    );

    const stav = screen.getByTestId('save-status');
    const ulozit = screen.getByRole('button', { name: 'Uložit' });
    expect(stav.parentElement).toBe(ulozit.parentElement);
    expect(stav.nextElementSibling).toBe(ulozit);
  });

  /*
   * Delší věta nesmí posunout tlačítko. Drží to POŘADÍ, ne pevná šířka:
   * skupina je ukotvená pravou hranou (`ml-auto`) a stav je v ní první, takže
   * text roste doleva. Pevná šířka by nešla, věty o chybě nesou celou hlášku
   * ze serveru.
   */
  it('stav je v pravé skupině první, takže delší text roste doleva', () => {
    wrap(
      <EditorHeader
        mode="edit"
        onMode={vi.fn()}
        onTestSend={vi.fn()}
        onSave={vi.fn()}
        readOnly={false}
      />,
      createEditorStore({ document: doc(), designHash: 'h1' }),
    );

    const group = screen.getByTestId('save-status').parentElement;
    expect(group?.firstElementChild).toBe(screen.getByTestId('save-status'));
    expect(group?.className).toContain('ml-auto');
    expect(group?.className).not.toContain('row-reverse');
  });
});

describe('ukládání v hlavičce editoru', () => {
  it('tlačítko Uložit v editoru existuje', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeInTheDocument();
  });

  it('bez neuložené změny je Uložit vypnuté, ať neslibuje něco, co neudělá', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('po vložení návrhu je Uložit aktivní a v hlavičce stojí Neuložené změny', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    // Přesně to dělá panel AI asistenta, když vloží návrh do editoru.
    act(() => store.replaceDocument(doc(), 'h1'));
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Neuložené změny');
  });

  it('kliknutí na Uložit spustí zápis', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const onSave = header(store);
    act(() => store.replaceDocument(doc(), 'h1'));
    screen.getByRole('button', { name: 'Uložit' }).click();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('během ukládání je tlačítko vypnuté, aby nešlo poslat dva zápisy', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    act(() => store.replaceDocument(doc(), 'h1'));
    act(() => store.setStatus('saving'));
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('v režimu jen pro čtení se Uložit nenabízí', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store, vi.fn(), true);
    expect(screen.queryByRole('button', { name: 'Uložit' })).not.toBeInTheDocument();
  });
});

/**
 * ČERSTVĚ OTEVŘENÝ EDITOR ŘEKNE, ŽE SE UKLÁDÁ SÁM.
 *
 * Do téhle chvíle tam stál prázdný řetězec: `status` je `idle`, `isDirty`
 * `false` a `savedAt` `null`, dokud uživatel poprvé něco nezmění. Obrazovka
 * tedy o ukládání neřekla vůbec nic a jedinou jistotou bylo tlačítko „Uložit",
 * přestože `useAutosave` běží celou dobu.
 */
describe('prázdný stav ukazatele ukládání', () => {
  it('místo prázdna stojí v hlavičce věta o průběžném ukládání', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    expect(screen.getByTestId('save-status')).toHaveTextContent('Ukládá se samo');
  });

  it('po první změně větu vystřídá skutečný stav', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    act(() => store.replaceDocument(doc(), 'h1'));
    expect(screen.getByTestId('save-status')).toHaveTextContent('Neuložené změny');
  });

  it('v režimu jen pro čtení se neslibuje ukládání, tam se nic neukládá', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store, vi.fn(), true);
    expect(screen.getByTestId('save-status')).toHaveTextContent('');
    expect(screen.getByTestId('save-status').textContent).toBe('');
  });

  /*
   * ŽIVÁ OBLAST. Bez ní se změna „Ukládáme…" → „Uloženo v 10:24" nedozví ten,
   * kdo se na hlavičku nedívá. `polite` uživatele nepřeruší uprostřed psaní
   * a `atomic` zajistí, že se přečte celá věta, ne jen změněné slovo.
   */
  it('změnu stavu ohlásí čtečka, a to celou větou', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    const stav = screen.getByTestId('save-status');
    expect(stav).toHaveAttribute('aria-live', 'polite');
    expect(stav).toHaveAttribute('aria-atomic', 'true');
  });
});

/**
 * VĚTA ZE SERVERU U ODMÍTNUTÉHO ULOŽENÍ.
 *
 * Doménové závory seznamu (potvrzovací e-mail bez odkazu na potvrzení,
 * odhlašovací odkaz v uvítacím a rozloučovacím e-mailu) vracejí 422 s celou
 * instrukcí, co má autor opravit. Do téhle chvíle z ní v hlavičce zbylo obecné
 * „dokument je neplatný", takže se člověk v editoru neměl podle čeho zařídit.
 */
describe('hlavička u odmítnutého uložení', () => {
  const SERVER_SENTENCE =
    'Tenhle e-mail je připojený jako potvrzovací, takže musí obsahovat odkaz na potvrzení.';

  it('ukáže větu ze serveru místo obecné hlášky', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid', SERVER_SENTENCE));

    expect(screen.getByTestId('save-status')).toHaveTextContent(SERVER_SENTENCE);
  });

  it('bez věty ze serveru zůstane obecná hláška', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid'));

    expect(screen.getByTestId('save-status')).toHaveTextContent(csEditor.header.saveInvalid);
  });

  it('po úspěšném uložení věta zmizí', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid', SERVER_SENTENCE));
    act(() => store.markSaved('h2', Date.now()));

    expect(screen.getByTestId('save-status')).not.toHaveTextContent(SERVER_SENTENCE);
  });
});

/**
 * EDITOR STRÁNKY NENÍ EDITOR E-MAILU.
 *
 * Zadavatel 7. 8. 2026 nahlásil, že na návrhu veřejné stránky svítí „Poslat
 * test" a v panelu nálezů dvě chyby o e-mailu („nemá odkaz na odhlášení",
 * „odkazy v e-mailu by příjemcům nefungovaly"). Je to jedna vada ve dvou
 * podobách: stránka se NIKDY neodesílá, otevírá se v prohlížeči z odkazu.
 *
 * Tlačítko, které slibuje akci, co nemůže nastat, je horší než chybějící:
 * člověk na něj klikne dřív, než zjistí, že tam nemá co dělat.
 */
describe('hlavička editoru u veřejné stránky', () => {
  const withKind = (templateKind?: string) => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    wrap(
      <EditorHeader
        mode="edit"
        onMode={vi.fn()}
        onTestSend={vi.fn()}
        onSave={vi.fn()}
        readOnly={false}
        {...(templateKind === undefined ? {} : { templateKind })}
      />,
      store,
    );
  };

  it('u stránky se zkušební odeslání NENABÍZÍ', () => {
    withKind('page');
    expect(screen.queryByTestId('editor-test-send')).toBeNull();
  });

  it('u kampaně zůstává, zúžení se týká jen stránky', () => {
    withKind('campaign');
    expect(screen.getByTestId('editor-test-send')).toBeInTheDocument();
  });

  it('bez zadaného druhu zůstává taky, aby se nesebralo omylem všem', () => {
    withKind();
    expect(screen.getByTestId('editor-test-send')).toBeInTheDocument();
  });
});
