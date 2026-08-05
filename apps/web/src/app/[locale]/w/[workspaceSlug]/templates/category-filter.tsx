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
                    ? 'inline-flex min-h-11 items-center gap-2 rounded-full border border-accent-text bg-accent-surface px-4 text-sm font-medium text-accent-text'
                    : 'inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm text-text hover:bg-surface-muted'
                }
              >
                {option.label}
                <span className="text-text-muted tabular-nums">{option.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
