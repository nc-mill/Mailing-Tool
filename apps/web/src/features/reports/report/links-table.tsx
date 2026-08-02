'use client';

import { useFormatter, useTranslations } from 'next-intl';

export type LinkRow = {
  link_id: string;
  url: string;
  label: string | null;
  clicks_total: number;
  clicks_unique: number;
  clicks_human: number;
  share: number;
  duplicate_url: boolean;
};

export function LinksTable({ links, disabled }: { links: LinkRow[]; disabled: boolean }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  if (disabled) {
    return (
      <section
        aria-labelledby="links-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="links-heading" className="text-base font-semibold">
          {t('report.links.heading')}
        </h2>
        <p>{t('report.states.trackingOffClicks')}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="links-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="links-heading" className="text-base font-semibold">
        {t('report.links.heading')}
      </h2>
      {links.length === 0 ? (
        <p>{t('report.links.empty')}</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">{t('report.links.heading')}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th scope="col" className="pb-2 text-left font-normal">
                {t('report.links.columnLink')}
              </th>
              {/* Záhlaví je popisek sloupce, ne skloňovaná věta. Původní znění
                  z plánu sem dosazovalo tvar pro nulu, takže v hlavičce stálo
                  „žádné kliknutí“ a „nikdo“. */}
              <th scope="col" className="pb-2 text-right font-normal">
                {t('report.links.columnClicks')}
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                {t('report.links.columnPeople')}
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                {t('report.links.share')}
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.link_id} className="border-t border-border first:border-t-0">
                <th scope="row" className="py-2 text-left font-normal">
                  {link.label ?? link.url}
                  {link.duplicate_url ? (
                    <span className="ml-1 text-xs text-text-muted">
                      {t('report.links.duplicate')}
                    </span>
                  ) : null}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {t('report.links.clicks', { count: link.clicks_human })}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {t('report.links.people', { count: link.clicks_unique })}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {format.number(link.share, { style: 'percent', maximumFractionDigits: 1 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
