'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE: Record<string, Tone> = {
  draft: 'neutral',
  scheduled: 'accent',
  queueing: 'accent',
  sending: 'accent',
  paused: 'warning',
  sent: 'success',
  partially_sent: 'warning',
  cancelled: 'neutral',
  failed: 'danger',
  schedule_missed: 'danger',
};

const KEY: Record<string, string> = {
  draft: 'draft',
  scheduled: 'scheduled',
  queueing: 'queueing',
  sending: 'sending',
  paused: 'paused',
  sent: 'sent',
  partially_sent: 'partiallySent',
  cancelled: 'cancelled',
  failed: 'failed',
  schedule_missed: 'scheduleMissed',
};

/**
 * Výčet stavů je OTEVŘENÝ: nová hodnota smí přijít v rámci v1 a klient ji musí
 * tolerovat. Žádný switch bez větve default, žádné zahození odpovědi kvůli neznámé
 * hodnotě. Neznámý stav se ukáže neutrálně, syrový.
 *
 * ODZNAK JE BEZ IKONY. Návrh má v řádku seznamu jen mono verzálky na barevné
 * ploše a `Badge` ikonu nevyžaduje: rozlišovacím znakem je slovo, ne obrázek.
 * Dřív tu ikony byly, protože komponenta je kdysi měla povinné.
 *
 * Animaci běžícího stavu nese `aria-live` a text, ne blikání.
 */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('campaigns.status');
  const key = KEY[status];
  const label = key ? t(key) : status;
  const animated = status === 'queueing' || status === 'sending';

  return (
    <span aria-live={animated ? 'polite' : undefined} data-status={status}>
      <Badge tone={TONE[status] ?? 'neutral'}>{label}</Badge>
    </span>
  );
}
