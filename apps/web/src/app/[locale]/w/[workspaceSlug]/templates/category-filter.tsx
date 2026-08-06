import { Link } from '@mlain/i18n/navigation';
import { getTranslations } from 'next-intl/server';

/**
 * Kategorie knihovny, jak je zná rozhraní. Hodnoty se shodují s parametrem
 * `category` v `GET /api/v1/templates`; překlad na `templates.kind` a na vazbu
 * z formuláře dělá jádro, ne tahle obrazovka.
 */
export const TEMPLATE_CATEGORIES = ['campaign', 'form', 'transactional'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateCategoryCounts = {
  all: number;
  campaign: number;
  form: number;
  transactional: number;
};

/**
 * Neznámá hodnota v adrese se ignoruje, nepadá.
 *
 * `?category=cokoli` je adresa, kterou si kdokoli může vymyslet nebo zdědit po
 * přejmenování. Odpovědět na ni chybou by z překlepu udělalo rozbitou stránku;
 * knihovna bez filtru je pravdivá odpověď na „takovou kategorii neznám".
 */
export function readCategory(raw: string | string[] | undefined): TemplateCategory | undefined {
  return TEMPLATE_CATEGORIES.find((category) => category === raw);
}

/**
 * Filtr knihovny šablon.
 *
 * JE TO ODKAZ, NE PŘEPÍNAČ VE STAVU KOMPONENTY. Kategorie patří do adresy,
 * protože jinak by tlačítko zpět vracelo z knihovny pryč místo na předchozí
 * kategorii a odkaz na „transakční e-maily" by se nedal poslat kolegovi.
 * Serverová komponenta navíc znamená, že seznam odpovídá filtru už v prvním
 * vykreslení, bez probliknutí celé knihovny.
 *
 * Parametry `undo` a `undo_name` se do odkazů NEPŘEBÍRAJÍ. Nabídka vrácení
 * smazané šablony patří k jednomu okamžiku, ne k filtru; po přepnutí kategorie
 * by visela nad seznamem, kde ta šablona ani nebyla.
 *
 * VZHLED je převzatý z filtru příjemců v návrhu kampaní: obdélníkový štítek
 * s hairline rámečkem, rádius 4 px a mono 13 px. Dřív to byly kulaté pilulky,
 * jenže systém zná jen dva rádiusy, 4 px na ovládací prvky a 10 px na plochy;
 * `rounded-full` je vyhrazený přepínači a tečkám. Zvolený štítek stojí na žluté
 * ploše se zvýrazněným rámečkem, tedy stejně jako vybraný řádek tabulky.
 * Výška zůstává 44 px, ne 34 px z návrhu: klikací plocha se kvůli vzhledu
 * nezmenšuje.
 */
export async function CategoryFilter({
  basePath,
  active,
  counts,
}: {
  basePath: string;
  active: TemplateCategory | undefined;
  counts: TemplateCategoryCounts;
}) {
  const t = await getTranslations('editor');
  const options: Array<{ key: TemplateCategory | 'all'; label: string; count: number }> = [
    { key: 'all', label: t('list.category.all'), count: counts.all },
    { key: 'campaign', label: t('list.category.campaign'), count: counts.campaign },
    { key: 'form', label: t('list.category.form'), count: counts.form },
    {
      key: 'transactional',
      label: t('list.category.transactional'),
      count: counts.transactional,
    },
  ];

  /**
   * Podtržení odkazu kreslí globální styl na `<a>`, takže `no-underline` musí
   * být na samotném odkazu. Na potomkovi by nezabralo.
   */
  const base = [
    'inline-flex min-h-[var(--size-target-min)] items-center gap-2',
    'rounded-[var(--radius-control)] border px-3',
    'font-mono text-meta no-underline',
    'transition-colors duration-[var(--duration-fast)]',
  ].join(' ');

  return (
    <nav aria-label={t('list.category.legend')} data-testid="template-categories">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const current = option.key === 'all' ? active === undefined : active === option.key;
          return (
            <li key={option.key}>
              <Link
                href={option.key === 'all' ? basePath : `${basePath}?category=${option.key}`}
                // `aria-current` nese zvolený stav pro odečítač; barva ho nese
                // pro ostatní. Stav se nikdy nesděluje jen barvou (11.3).
                {...(current ? { 'aria-current': 'page' as const } : {})}
                data-testid={`template-category-${option.key}`}
                className={
                  current
                    ? `${base} border-primary-hover bg-accent-surface text-accent-text`
                    : `${base} border-border bg-surface text-text hover:bg-surface-muted`
                }
              >
                {option.label}
                {/*
                  Ve zvoleném štítku počet barvu NEMĚNÍ: tlumená šedozelená na
                  žluté ploše je na hraně kontrastu, kdežto zděděná barva
                  štítku je čitelná stejně jako jeho popisek.
                */}
                <span className={current ? 'tabular-nums' : 'tabular-nums text-text-muted'}>
                  {option.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
