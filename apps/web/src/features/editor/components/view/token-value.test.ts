import { describe, expect, it } from 'vitest';
import { exprPath, resolvePath, tokenValue } from './token-value';

describe('hodnoty značek pro plátno', () => {
  const root = {
    contact: { first_name: 'Jana', last_name: '', attr: { city: 'Brno' } },
    campaign: { name: 'Letní výprodej' },
  };

  it('cesta se čte i přes vlastní atributy', () => {
    expect(resolvePath(root, 'contact.attr.city')).toBe('Brno');
    expect(resolvePath(root, 'campaign.name')).toBe('Letní výprodej');
  });

  it('filtr v předpisu se do cesty nepočítá', () => {
    // `expr` může znít `contact.first_name | default`, argumenty filtrů nesou
    // vlastní pole uzlu. Kdyby se filtr počítal do cesty, nenašlo by se nic.
    expect(exprPath('contact.first_name | default')).toBe('contact.first_name');
    expect(tokenValue(root, { expr: 'contact.first_name | default' })).toBe('Jana');
  });

  it('prázdnou hodnotu nahradí náhrada, stejně jako filtr default v Liquidu', () => {
    expect(tokenValue(root, { expr: 'contact.last_name', fallback: 'zákazníku' })).toBe(
      'zákazníku',
    );
    expect(tokenValue(root, { expr: 'contact.nic', fallback: 'zákazníku' })).toBe('zákazníku');
  });

  it('bez náhrady zůstane po prázdné hodnotě prázdno, ne název pole', () => {
    // Díra v textu je poctivá informace: přesně tak e-mail dojde kontaktu,
    // kterému pole chybí. Vypsat místo toho „Jméno" by lhalo.
    expect(tokenValue(root, { expr: 'contact.last_name' })).toBe('');
  });
});
