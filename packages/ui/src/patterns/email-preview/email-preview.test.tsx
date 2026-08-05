import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
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

  it('OBRÁZEK Z VLASTNÍ INSTALACE se v náhledu načíst smí', () => {
    // `img-src data:` samotné znamenalo rozbitou dlaždici místo obrázku
    // z knihovny médií: emitter skládá absolutní `http(s)` adresu
    // (`<ASSET_BASE_URL>/a/<public_id>/<varianta>.<přípona>`), kterou
    // `data:` zakáže. Uživatel viděl prázdné místo, přestože adresa fungovala.
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain(`img-src data: ${window.location.origin}`);
  });

  it('CIZÍ původ se do CSP nedostane, slib o nulové komunikaci platí dál', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const csp = (screen.getByTitle(title).getAttribute('srcdoc') as string)
      .match(/img-src ([^;]+);/)?.[1]
      ?.trim();
    // Povolený je právě `data:` a vlastní původ, nic jiného. Žádné `*`,
    // žádné holé `https:`, které by propustilo sledovací pixel z cizí domény.
    expect(csp).toBe(`data: ${window.location.origin}`);
  });

  it('RÁM SE VLOŽÍ AŽ S HOTOVOU CSP, ne s prozatímní', () => {
    // Tohle je oprava prázdného náhledu, ne kosmetika. Když se rám vložil
    // s CSP `img-src data:` a hned nato se mu `srcdoc` přepsala podobou
    // s vlastním původem, Chromium ho nechalo NEVYKRESLENÝ: obsah byl v DOM,
    // ale na obrazovce prázdný bílý obdélník. První vykreslení proto rám
    // vůbec nemá, jen prázdné místo stejné velikosti.
    const markup = renderToStaticMarkup(<EmailPreview html={html} title={title} labels={labels} />);
    expect(markup).not.toContain('<iframe');
    expect(markup).toContain('email-preview-placeholder');
  });

  it('když původy určuje volající, rám je na místě hned napoprvé', () => {
    const markup = renderToStaticMarkup(
      <EmailPreview html={html} title={title} imageOrigins={['https://cdn.priklad.cz']} />,
    );
    expect(markup).toContain('<iframe');
    expect(markup).toContain('img-src data: https://cdn.priklad.cz;');
  });

  it('instalace s obrázky na CDN si původ může nastavit', () => {
    render(
      <EmailPreview
        html={html}
        title={title}
        labels={labels}
        imageOrigins={['https://cdn.priklad.cz']}
      />,
    );
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain('img-src data: https://cdn.priklad.cz;');
  });

  it('prázdný seznam původů vrátí nejpřísnější stav', () => {
    render(<EmailPreview html={html} title={title} labels={labels} imageOrigins={[]} />);
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain('img-src data:;');
  });

  it('apostrof v původu direktivu neukončí', () => {
    // Hodnota jde do atributu `content` skládaného řetězcem. Apostrof nebo
    // středník by z původu udělal další direktivu.
    render(
      <EmailPreview
        html={html}
        title={title}
        labels={labels}
        imageOrigins={["https://zly.cz'; script-src *"]}
      />,
    );
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain("script-src 'none'");
    expect(srcdoc).not.toContain('script-src *');
  });

  it('TMAVÝ REŽIM sáhne po tmavé paletě e-mailu, ne jen po pozadí rámu', async () => {
    // Media dotaz `prefers-color-scheme` uvnitř rámu ovlivnit nejde, řídí ho
    // systém. Bez tohohle háku přepínač jen ztmavil pozadí rámu, které e-mail
    // vzápětí přetřel vlastním bílým pozadím, takže se nezměnilo nic viditelného.
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title).getAttribute('srcdoc')).not.toContain('data-ogsc');

    await user.click(screen.getByRole('button', { name: 'Tmavý režim' }));
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain('data-ogsc');
    expect(srcdoc).toContain('data-ogsb');
    // Atributy patří na kořen dokumentu, jinak potomky nevyberou.
    expect(srcdoc).toMatch(/<html[^>]*data-ogsc/);
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
