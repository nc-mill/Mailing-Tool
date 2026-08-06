'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Tag } from '@mlain/ui/components/tag';

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
      <Card aria-labelledby="links-heading">
        <CardTitle>
          <span id="links-heading">{t('report.links.heading')}</span>
        </CardTitle>
        <p className="text-ui text-text-muted">{t('report.states.trackingOffClicks')}</p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="links-heading">
      <CardTitle>
        <span id="links-heading">{t('report.links.heading')}</span>
      </CardTitle>
      {links.length === 0 ? (
        <p className="text-ui text-text-muted">{t('report.links.empty')}</p>
      ) : (
        <table className="w-full">
          <caption className="sr-only">{t('report.links.heading')}</caption>
          <thead>
            <tr>
              <th scope="col" className="meta-caps pb-2 text-left text-text-muted">
                {t('report.links.columnLink')}
              </th>
              {/* Záhlaví je popisek sloupce, ne skloňovaná věta. Původní znění
                  z plánu sem dosazovalo tvar pro nulu, takže v hlavičce stálo
                  „žádné kliknutí“ a „nikdo“. */}
              <th scope="col" className="meta-caps pb-2 text-right text-text-muted">
                {t('report.links.columnClicks')}
              </th>
              <th scope="col" className="meta-caps pb-2 text-right text-text-muted">
                {t('report.links.columnPeople')}
              </th>
              <th scope="col" className="meta-caps pb-2 text-right text-text-muted">
                {t('report.links.share')}
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.link_id} className="border-t border-border">
                <th scope="row" className="py-3 text-left text-ui font-semibold text-text">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate">{link.label ?? link.url}</span>
                    {link.duplicate_url ? <Tag>{t('report.links.duplicate')}</Tag> : null}
                  </span>
                </th>
                <td className="py-3 text-right font-mono text-sm tabular-nums text-text">
                  {t('report.links.clicks', { count: link.clicks_human })}
                </td>
                <td className="py-3 text-right font-mono text-sm tabular-nums text-text">
                  {t('report.links.people', { count: link.clicks_unique })}
                </td>
                <td className="py-3 text-right font-mono text-sm tabular-nums text-text">
                  {format.number(link.share, { style: 'percent', maximumFractionDigits: 1 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
