// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMBED_CLASSES, buildEmbedScript } from '../../src/features/public/embed-script';

const base = {
  ref: 'abc',
  action: 'https://app.mlain.test/f/abc/submit',
  nonceUrl: 'https://app.mlain.test/f/abc/nonce',
  submitLabel: 'Přihlásit se',
  successMessage: 'Hotovo',
  honeypot: 'website',
  consentText: '',
  consentRequired: true,
  fields: [{ name: 'email', label: 'E-mail', type: 'email' as const, required: true }],
};

describe('vkládací skript', () => {
  it('skládá strom přes createElement, nikdy přes innerHTML', () => {
    const script = buildEmbedScript(base);
    // Do formuláře jdou popisky z databáze, tedy hodnoty zadané uživatelem nástroje.
    // Přiřazení do innerHTML by z nich udělalo spustitelný obsah na CIZÍ stránce.
    expect(script).not.toContain('innerHTML');
    expect(script).toContain('createElement');
    expect(script).toContain('textContent');
  });

  it('popisek s uzavírací značkou skriptu neukončí značku na hostitelské stránce', () => {
    const script = buildEmbedScript({
      ...base,
      fields: [
        {
          name: 'email',
          label: '</script><img src=x onerror=alert(1)>',
          type: 'text',
          required: false,
        },
      ],
    });
    // Kdyby v datech zůstala doslovná sekvence </script>, prohlížeč by značku ukončil
    // a zbytek definice by se stal HTML. Je to nejlevnější XSS na cizím webu.
    expect(script).not.toContain('</script>');
    expect(script).toContain('<\\/script>');
  });

  it('sám o sobě nic nesleduje', () => {
    const script = buildEmbedScript(base);
    for (const forbidden of ['/e/track', '/t/o/', 'sendBeacon', 'document.cookie']) {
      expect(script).not.toContain(forbidden);
    }
  });

  /**
   * Rozhodnutí zadavatele ze 4. 8. 2026: formulář nesmí nést žádné CSS a musí jít
   * ostylovat až na webu, kam se vloží. Tyhle tři testy jsou jeho brána.
   */
  it('nevykresluje do zapouzdřeného stromu, aby na něj CSS webu dosáhlo', () => {
    const script = buildEmbedScript(base);
    // Shadow DOM izoluje oběma směry: co styly webu nerozbijí, to taky neostylují.
    expect(script).not.toContain('attachShadow');
  });

  it('nenese značku style ani vlastní CSS z nastavení formuláře', () => {
    const script = buildEmbedScript(base);
    expect(script).not.toContain("createElement('style')");
    expect(script).not.toContain('def.css');
  });

  it('dává značkám úchyty, aby bylo na co cílit selektorem', () => {
    const script = buildEmbedScript(base);
    // Veřejný kontrakt: kdo si podle nich nastyluje formulář, tomu ho
    // přejmenování rozbije, a jeho web přitom nespadne.
    for (const hook of Object.values(EMBED_CLASSES)) {
      expect(script).toContain(hook);
    }
  });

  it('hlásí stavy data atributy, ne třídami', () => {
    const script = buildEmbedScript(base);
    expect(script).toContain('data-ml-state');
    expect(script).toContain('data-ml-invalid');
  });

  it('vykreslí zaškrtávátko souhlasu, když je text souhlasu vyplněný', () => {
    const script = buildEmbedScript({ ...base, consentText: 'Souhlasím se zasíláním novinek.' });
    expect(script).toContain('ml-consent');
    expect(script).toContain('Souhlasím se zasíláním novinek.');
  });

  it('vyžádá si nonce hned při vykreslení a pošle ho s odesláním', () => {
    const script = buildEmbedScript(base);
    // Bez nonce druhá vrstva ochrany odeslání TIŠE zahodí: odpověď je `ok: true`,
    // ale kontakt nevznikne. Naměřeno na instalaci jako `dropped / missing_nonce`.
    expect(script).toContain('def.nonceUrl');
    expect(script).toContain('ml_nonce');
  });

  it('míří na absolutní adresy, protože běží na cizí doméně', () => {
    const script = buildEmbedScript(base);
    // Relativní `/f/…/submit` by na cizím webu mířilo na web zákazníka.
    expect(script).toContain('https://app.mlain.test/f/abc/submit');
    expect(script).toContain('https://app.mlain.test/f/abc/nonce');
  });

  it('jediné inline styly patří časové pasti, která musí zůstat skrytá', () => {
    const script = buildEmbedScript(base);
    // Viditelné pole pasti by lidé vyplňovali a ochrana by jejich odeslání zahodila.
    const styleAssignments = script.match(/\.style\.[a-zA-Z]+ =/g) ?? [];
    expect(styleAssignments).toEqual(['.style.position =', '.style.left =']);
  });
});
