import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import { forbiddenSchemeOf, safeHref } from '../../src/document/href';
import type { TemplateKind } from '../../src/document/profile';
import { checkStructure } from '../../src/document/semantic-structure';
import type { Document } from '../../src/document/types';

/**
 * VRSTVA 1 ze tří: schéma odkazu se kontroluje i tehdy, když je v odkazu Liquid.
 *
 * Nález: `checkHref` se u odkazu s Liquidem vracela DŘÍV, než se dostala ke
 * kontrole schémat. U profilu `page` se odkazy nesledují, takže nevzniklo ani
 * varování a `javascript:alert(document.domain)#{{ x }}` prošlo až do uložené
 * šablony. Zbylé dvě vrstvy mají vlastní testy, tenhle soubor se ptá jen
 * validace dokumentu.
 */

const docOf = (children: unknown[]): Document =>
  ({
    schemaVersion: 1,
    meta: { name: 'Stránka', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children,
      },
    ],
  }) as Document;

const buttonWith = (href: string, trackable = true) => ({
  id: 'b_000000000002',
  type: 'button',
  props: { ...blockDefaults('button'), href, trackable },
});

const linkWith = (href: string, trackable = true) => ({
  id: 'b_000000000003',
  type: 'text',
  props: {
    ...blockDefaults('text'),
    content: [{ t: 'p', children: [{ t: 'a', href, trackable, children: [{ t: 's', v: 'x' }] }] }],
  },
});

const codes = (children: unknown[], kind: TemplateKind = 'page'): string[] =>
  checkStructure(docOf(children), { templateKind: kind }).map((issue) => issue.code);

/** Zakázané schéma, ať už je odkaz kdekoli a v jakémkoli profilu. */
const rejected = (href: string): void => {
  for (const kind of ['page', 'campaign', 'transactional'] as const) {
    expect(codes([buttonWith(href)], kind), `tlačítko ${kind}: ${href}`).toContain(
      'content_link_scheme_forbidden',
    );
    expect(codes([linkWith(href, false)], kind), `odkaz ${kind}: ${href}`).toContain(
      'content_link_scheme_forbidden',
    );
  }
};

const accepted = (href: string): void => {
  for (const kind of ['page', 'campaign', 'transactional'] as const) {
    expect(codes([buttonWith(href, false)], kind), `${kind}: ${href}`).not.toContain(
      'content_link_scheme_forbidden',
    );
  }
};

describe('schéma odkazu s Liquidem (vrstva 1: validace dokumentu)', () => {
  it('odmítne javascript: s Liquidem ZA sebou, tedy přesně nahlášenou cestu útoku', () => {
    rejected('javascript:alert(document.domain)#{{ x }}');
  });

  it('odmítne javascript: s Liquidem PŘED sebou, protože konstrukce se při vykreslení vypaří', () => {
    rejected('{{ x }}javascript:alert(1)');
    rejected('{% if x %}{% endif %}javascript:alert(1)');
  });

  it('odmítne javascript: rozseknuté konstrukcí uprostřed', () => {
    // Po vykreslení se z toho slepí `javascript:`. Před ním to není ani schéma,
    // takže samotný `new URL` by nic nenašel.
    rejected('jav{{ contact.attr.city }}ascript:alert(1)');
  });

  it('odmítne javascript: bez ohledu na velikost písmen a na neviditelné znaky', () => {
    rejected('JaVaScRiPt:alert(1)');
    // Tabulátor a konec řádku prohlížeč z adresy vyhodí, než ji vyhodnotí.
    rejected('java\tscript:alert(1)');
    rejected('java\nscript:alert(1)');
    rejected('  javascript:alert(1)');
  });

  it('odmítne data: i vbscript:, se stejným kódem', () => {
    rejected('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
    rejected('data:text/html,<script>alert(1)</script>{{ x }}');
    rejected('vbscript:msgbox(1)');
    rejected('{{ x }}vbscript:msgbox(1)');
    rejected('file:///etc/passwd');
  });

  it('nechá projít systémové odkazy, které dosazuje sender', () => {
    for (const tag of ['{{ unsubscribe_url }}', '{{ preferences_url }}', '{{ webview_url }}']) {
      expect(codes([buttonWith(tag)], 'campaign'), tag).not.toContain(
        'content_link_scheme_forbidden',
      );
      expect(codes([buttonWith(tag)], 'campaign'), tag).not.toContain('liquid_in_trackable_href');
      expect(codes([buttonWith(tag)], 'page'), tag).toEqual([]);
    }
  });

  it('nechá projít mailto:, tel: i běžné https, i s personalizací uvnitř', () => {
    accepted('https://priklad.cz/dal');
    accepted('http://priklad.cz/dal');
    accepted('mailto:podpora@priklad.cz');
    accepted('mailto:{{ contact.email }}');
    accepted('tel:+420123456789');
    accepted('https://priklad.cz/?utm={{ campaign.name }}');
    accepted('https://priklad.cz/{% if contact.attr.is_vip %}vip{% endif %}');
  });

  it('nechá projít odkaz, který CELÝ vznikne z proměnné', () => {
    // Schéma tam žádné není a přidat ho může jen dosazená hodnota, ne autor.
    // Zakázat tenhle tvar by rozbilo transakční šablony i navržené stránky,
    // kde je `{{ data.confirm_url }}` normální a jediný možný zápis.
    expect(codes([buttonWith('{{ data.confirm_url }}')], 'page')).toEqual([]);
    expect(codes([buttonWith('{{ data.reset_url }}')], 'transactional')).toEqual([]);
    expect(codes([buttonWith('{{ contact.attr.city }}', false)], 'campaign')).toContain(
      'link_variable_not_tracked',
    );
  });

  it('nemění chování u odkazu s proměnnou, jen mu předřazuje kontrolu schématu', () => {
    // Kampaň s trackováním: pořád `liquid_in_trackable_href`, ne nový kód.
    expect(codes([buttonWith('https://shop.cz/?utm={{ campaign.name }}')], 'campaign')).toEqual([
      'liquid_in_trackable_href',
    ]);
    expect(
      codes([buttonWith('https://shop.cz/?utm={{ campaign.name }}', false)], 'campaign'),
    ).toEqual(['link_variable_not_tracked']);
  });

  it('hlásí schéma v parametrech nálezu, aby šlo napsat, co je špatně', () => {
    const issues = checkStructure(docOf([buttonWith('javascript:alert(1)#{{ x }}')]), {
      templateKind: 'page',
    });
    const found = issues.find((issue) => issue.code === 'content_link_scheme_forbidden');
    expect(found?.params).toEqual({ scheme: 'javascript:' });
    expect(found?.pointer).toBe('/blocks/0/children/0/props/href');
  });

  it('platí i pro odkaz obrázku a pro sociální ikonu', () => {
    const image = {
      id: 'b_000000000004',
      type: 'image',
      props: {
        ...blockDefaults('image'),
        assetId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
        alt: 'Logo',
        href: 'javascript:alert(1)#{{ x }}',
      },
    };
    const social = {
      id: 'b_000000000005',
      type: 'social',
      props: {
        ...blockDefaults('social'),
        items: [{ network: 'facebook', href: '{{ x }}javascript:alert(1)' }],
      },
    };
    expect(codes([image])).toContain('content_link_scheme_forbidden');
    expect(codes([social])).toContain('content_link_scheme_forbidden');
  });
});

describe('forbiddenSchemeOf a safeHref', () => {
  it('vrací schéma jen u zakázaných, u povolených a bezschémových nic', () => {
    expect(forbiddenSchemeOf('javascript:alert(1)')).toBe('javascript:');
    expect(forbiddenSchemeOf('{{ x }}javascript:alert(1)')).toBe('javascript:');
    expect(forbiddenSchemeOf('https://priklad.cz')).toBeNull();
    expect(forbiddenSchemeOf('mailto:a@b.cz')).toBeNull();
    expect(forbiddenSchemeOf('/relativni/cesta')).toBeNull();
    expect(forbiddenSchemeOf('{{ unsubscribe_url }}')).toBeNull();
    expect(forbiddenSchemeOf('{{ data.confirm_url }}')).toBeNull();
  });

  it('degraduje jen zakázané schéma, ostatní odkazy vrací nedotčené', () => {
    expect(safeHref('javascript:alert(1)#{{ x }}')).toBe('#');
    expect(safeHref('https://track.mlain.invalid/c/0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071')).toBe(
      'https://track.mlain.invalid/c/0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
    );
    expect(safeHref('{{ unsubscribe_url }}')).toBe('{{ unsubscribe_url }}');
    expect(safeHref('https://priklad.cz/?utm={{ campaign.name }}')).toBe(
      'https://priklad.cz/?utm={{ campaign.name }}',
    );
  });
});
