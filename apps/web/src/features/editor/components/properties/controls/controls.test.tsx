import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCatalog } from '../../../model/field-catalog';
import { ColorControl } from './color-control';
import { LinkControl } from './link-control';
import { NumberControl } from './number-control';
import { VisibilityControl } from './visibility-control';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'city',
      type: 'string',
      label: { cs: 'Město', en: 'City' },
      group: 'custom',
      deleted: false,
    },
    {
      path: 'is_vip',
      type: 'boolean',
      label: { cs: 'VIP', en: 'VIP' },
      group: 'custom',
      deleted: false,
    },
    {
      path: 'old',
      type: 'string',
      label: { cs: 'Staré', en: 'Old' },
      group: 'custom',
      deleted: true,
    },
  ],
};

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

const base = {
  block: { id: 'b_1', type: 'text', props: {} },
  canWriteHtml: true,
  fieldCatalog: catalog,
  templateKind: 'campaign' as const,
  ports: null,
};

describe('ovládací prvky', () => {
  it('číslo hlídá meze z descriptoru', async () => {
    const onChange = vi.fn();
    wrap(
      <NumberControl
        {...base}
        id="n1"
        onChange={onChange}
        value={24}
        descriptor={{
          kind: 'number',
          key: 'height',
          label: 'prop.height',
          min: 4,
          max: 120,
          step: 4,
          unit: 'px',
        }}
      />,
    );
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '4');
    expect(input).toHaveAttribute('max', '120');
    await userEvent.clear(input);
    await userEvent.type(input, '200');
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it('barva nabízí role motivu i vlastní odstín', async () => {
    const onChange = vi.fn();
    wrap(
      <ColorControl
        {...base}
        id="c1"
        onChange={onChange}
        value="text.default"
        descriptor={{ kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true }}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'brand.primary');
    expect(onChange).toHaveBeenCalledWith('brand.primary');
  });

  /**
   * Stížnost zadavatele ze 4. 8. 2026: „V editoru mám výběr z [seznam
   * barevných rolí], ale nikde to není definované. Naprosto netuším, jak ta
   * barva vypadá. Popsaná barva textově bez vizuálního zobrazení je špatně."
   */
  it('barva ukazuje vzorky se skutečnými hodnotami z motivu, ne jen názvy', async () => {
    const onChange = vi.fn();
    wrap(
      <ColorControl
        {...base}
        id="c2"
        onChange={onChange}
        value="brand.primary"
        descriptor={{ kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true }}
      />,
    );

    // Vzorek zvolené role nese barvu z motivu, ne obecnou paletu aplikace.
    // `#2563eb` je `brand.primary` výchozího motivu (`theme/palette.ts`).
    const swatch = screen.getByTestId('color-swatch-color');
    expect(swatch).toHaveStyle({ backgroundColor: '#2563eb' });

    // Hex je vidět v textu, aby zůstal čitelný i bez rozeznávání barev.
    expect(screen.getByText(/#2563eb/)).toBeInTheDocument();

    // Každá role má vlastní vzorek a jeho přístupné jméno nese NÁZEV I HODNOTU.
    const muted = screen.getByRole('button', { name: /Ztlumený text #6b7280/ });
    await userEvent.click(muted);
    expect(onChange).toHaveBeenCalledWith('text.muted');
  });

  it('barva varuje u nízkého kontrastu týmž textem jako lišta nálezů', () => {
    wrap(
      <ColorControl
        {...base}
        id="c3"
        onChange={vi.fn()}
        // `surface.subtle` na bílém podkladu obsahu má kontrast hluboko pod 4,5:1.
        value="surface.subtle"
        descriptor={{ kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true }}
      />,
    );
    expect(screen.getByText('Text na tomhle pozadí je špatně čitelný.')).toBeInTheDocument();
  });

  it('odkaz odmítne zakázané schéma', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        id="l1"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'javascript:alert(1)');
    expect(screen.getByRole('alert')).toHaveTextContent(/https/);
    expect(onChange).not.toHaveBeenCalledWith('javascript:alert(1)');
  });

  // Sledovaný odkaz s proměnnou zůstává chybou: dynamický odkaz nejde trackovat,
  // protože campaign_links drží jednu pevnou URL na dvojici kampaň a pozice.
  it('odkaz odmítne proměnnou, dokud je sledování zapnuté', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        block={{ id: 'b_1', type: 'button', props: { trackable: true } }}
        id="l2"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), '{{{{ data.reset_url }}');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  // TOHLE je oprava, bez které nejde v editoru postavit reset hesla: s vypnutým
  // sledováním datový model proměnnou v odkazu připouští a rozhraní ji musí
  // uložit. Dřív ji zahodilo bez ohledu na sledování.
  it('s vypnutým sledováním proměnnou v odkazu uloží', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        block={{ id: 'b_1', type: 'button', props: { trackable: false } }}
        id="l3"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), '{{{{ data.reset_url }}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('{{ data.reset_url }}');
  });

  // Vypnutí sledování musí hodnotu napsanou při zapnutém sledování dopsat
  // a hlášku sundat, jinak uživatel zůstane u chyby, která už neplatí.
  it('vypnutí sledování dopíše odkaz s proměnnou a zruší hlášku', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        block={{ id: 'b_1', type: 'button', props: { trackable: true } }}
        id="l4"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), '{{{{ data.reset_url }}');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('{{ data.reset_url }}', { trackable: false });
  });

  /**
   * TOHLE je konec celého řetězu: v transakční šabloně se odkazy NESLEDUJÍ,
   * takže je proměnná v poli odkazu normální stav a editor ji musí uložit
   * i tehdy, když má blok `trackable: true`. Dřív editor v transakční šabloně
   * kontroloval kampaňovými pravidly a uživatel v něm reset hesla neuložil.
   */
  it('v transakčním profilu uloží proměnnou i se zapnutým sledováním bloku', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        templateKind="transactional"
        block={{ id: 'b_1', type: 'button', props: { trackable: true } }}
        id="l5"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), '{{{{ data.reset_url }}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('{{ data.reset_url }}');
  });

  it('podmínka zobrazení nabízí jen pole z katalogu a operátory podle typu', async () => {
    const onChange = vi.fn();
    wrap(
      <VisibilityControl
        {...base}
        id="v1"
        onChange={onChange}
        value={null}
        descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }}
      />,
    );
    const field = screen.getByLabelText(/Pole/);
    expect(screen.queryByText('Staré')).toBeNull(); // smazané pole se nenabízí
    await userEvent.selectOptions(field, 'contact.is_vip');
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'true',
      'false',
    ]);
  });

  it('podmínka nad textovým polem nabízí present a blank', async () => {
    wrap(
      <VisibilityControl
        {...base}
        id="v2"
        onChange={vi.fn()}
        value={{ field: 'contact.city', op: 'present' }}
        descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }}
      />,
    );
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'present',
      'blank',
    ]);
  });
});
