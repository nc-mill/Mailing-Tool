'use client';

import { useTranslations } from 'next-intl';
import { formatCount } from '@/features/segments/labels';

export type GateKey =
  | 'suppressed'
  | 'unsubscribed'
  | 'unconfirmed'
  | 'snoozed'
  | 'processing_restricted'
  | 'duplicate'
  | 'sample';

export type AudienceBreakdownData = {
  input: number;
  gates: { key: GateKey; count: number }[];
  willSend: number;
  inputLabel?: string;
};

/**
 * Rozpad publika po branách. Pořadí je pořadí VYHODNOCENÍ, ne abeceda: jeden
 * kontakt může padnout na víc bran a započítá se u té první, takže jen v tomhle
 * pořadí součet sedí.
 *
 * Používá ho i P13 na obrazovce kampaně, proto bydlí v `components`, ne
 * u obrazovky segmentů.
 */
export const GATE_ORDER: GateKey[] = [
  'suppressed',
  'unsubscribed',
  'unconfirmed',
  'snoozed',
  'processing_restricted',
  'duplicate',
  'sample',
];

const GATE_FILTER: Record<GateKey, string> = {
  suppressed: 'suppressed=true',
  unsubscribed: 'status=unsubscribed',
  unconfirmed: 'subscription=pending',
  snoozed: 'snoozed=true',
  processing_restricted: 'processing_restricted=true',
  duplicate: 'duplicate=true',
  sample: 'sample=true',
};

export function AudienceBreakdown({
  data,
  workspaceSlug = '',
  locale = 'cs',
}: {
  data: AudienceBreakdownData;
  workspaceSlug?: string;
  locale?: string;
}) {
  const t = useTranslations('segments');
  const byKey = new Map(data.gates.map((gate) => [gate.key, gate.count]));

  return (
    <section className="flex flex-col gap-2">
      <h2>{t('audience.title')}</h2>
      <p>
        {data.inputLabel ?? t('audience.input', { name: '' })} {formatCount(data.input, locale)}
      </p>

      <ul>
        {GATE_ORDER.map((key) => {
          const count = byKey.get(key) ?? 0;
          // Brána s nulou se NEZOBRAZUJE. Sedm řádků s nulou znamená, že si
          // uživatel seznam přestane číst, a přehlédne ten, který nulu nemá.
          if (count === 0) return null;
          return (
            <li key={key} data-testid="gate-row">
              <span data-testid="gate-label">{t(`audience.gates.${key}`)}</span>
              <span>{formatCount(count, locale)}</span>
              <a href={`/w/${workspaceSlug}/contacts?${GATE_FILTER[key]}`}>
                {t('audience.gateLink')}
              </a>
            </li>
          );
        })}
      </ul>

      <p>{t('audience.willSend', { count: data.willSend })}</p>
    </section>
  );
}
