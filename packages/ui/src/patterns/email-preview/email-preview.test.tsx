import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EmailPreview } from './email-preview';

const labels = {
  widthDesktop: 'Šířka počítače',
  widthMobile: 'Šířka mobilu',
  themeLight: 'Světlý režim',
  themeDark: 'Tmavý režim',
  blockedExternal: 'Náhled nenačítá nic z cizích serverů.',
};

const title = 'Náhled e-mailu';
const html =
  '<html><body><h1>Letní výprodej</h1><img src="https://cizi.example/a.png"></body></html>';

describe('EmailPreview', () => {
  it('vykresluje do iframe se sandboxem, ne do stránky', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const frame = screen.getByTitle(title);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('sandbox nemá jedinou výjimku, ani allow-same-origin', () => {
    // Tenhle test je tu proto, že o výjimku někdo požádal. `allow-same-origin`
    // by rámci vrátilo původ aplikace a izolaci oslabilo bez jakéhokoli zisku,
    // protože skripty stejně neběží. Kdyby výjimku někdo doplnil, spadne tohle.
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title).getAttribute('sandbox')).toBe('');
  });

  it('neposílá odkazující adresu, ani kdyby se CSP obešla', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('obsah e-mailu jde do srcdoc, takže neuteče do stylů aplikace', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('Letní výprodej'),
    );
  });

  it('vkládá CSP, která zakáže odchozí požadavky na cizí zdroje', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('img-src data:');
  });

  it('umí přepnout šířku vlastními přepínači', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'desktop');

    await user.click(screen.getByRole('button', { name: 'Šířka mobilu' }));
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'mobile');
  });

  it('umí přepnout tmavý režim náhledu nezávisle na aplikaci', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} />);
    await user.click(screen.getByRole('button', { name: 'Tmavý režim' }));
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'dark');
  });

  it('říká uživateli, že cizí zdroje nenačítá', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByText('Náhled nenačítá nic z cizích serverů.')).toBeVisible();
  });

  it('bez labels vlastní přepínače nevykreslí, protože je má obrazovka', () => {
    // Editor šablon má přepínače ve své liště nástrojů a nabízí navíc
    // textovou verzi a zdroj. Dvě sady stejných přepínačů vedle sebe
    // jsou horší než žádná.
    render(<EmailPreview html={html} title={title} width={375} dark />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'dark');
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'mobile');
  });

  it('šířku bere i jako číslo v pixelech', () => {
    render(<EmailPreview html={html} title={title} width={480} />);
    expect(screen.getByTitle(title)).toHaveStyle({ width: '480px' });
  });

  it('řízený režim se řídí propem, ne vlastním stavem', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} dark={false} />);
    await user.click(screen.getByRole('button', { name: 'Tmavý režim' }));
    // Prop vyhrává: bez onDarkChange se stav nemění, drží ho obrazovka.
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'light');
  });
});
