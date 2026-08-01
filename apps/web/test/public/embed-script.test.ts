// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildEmbedScript } from '../../src/features/public/embed-script';

const base = {
  ref: 'abc',
  action: 'https://app.mlain.test/f/abc/submit',
  submitLabel: 'Přihlásit se',
  successMessage: 'Hotovo',
  honeypot: 'website',
  css: '',
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
});
