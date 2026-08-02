'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { CheckIcon, ClockIcon, RunningIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';

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
 * Ikony kreslí `apps/web` sám (`lib/ui/status-icons`), protože `lucide-react`
 * je závislost `packages/ui`, ne aplikace, a doménový plán si do
 * `apps/web/package.json` produkční závislosti nepřidává.
 */
const ICON: Record<string, React.ReactNode> = {
  draft: ClockIcon,
  scheduled: ClockIcon,
  queueing: RunningIcon,
  sending: RunningIcon,
  paused: WarningIcon,
  sent: CheckIcon,
  partially_sent: WarningIcon,
  cancelled: SlashIcon,
  failed: WarningIcon,
  schedule_missed: WarningIcon,
};

/**
 * Výčet stavů je OTEVŘENÝ: nová hodnota smí přijít v rámci v1 a klient ji musí
 * tolerovat. Žádný switch bez větve default, žádné zahození odpovědi kvůli neznámé
 * hodnotě. Neznámý stav se ukáže neutrálně, syrový.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KOMPONENTOU. Plán psal `<Badge tone="blue" pulsing>`.
 * `Badge` z `packages/ui` má tóny `neutral | accent | success | warning | danger`,
 * `pulsing` nezná a `icon` naopak VYŽADUJE, protože stav se nikdy nesděluje jen
 * barvou. Animaci nese `aria-live` a text, ne blikání.
 */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('campaigns.status');
  const key = KEY[status];
  const label = key ? t(key) : status;
  const animated = status === 'queueing' || status === 'sending';

  return (
    <span aria-live={animated ? 'polite' : undefined} data-status={status}>
      <Badge tone={TONE[status] ?? 'neutral'} icon={ICON[status] ?? ClockIcon}>
        {label}
      </Badge>
    </span>
  );
}
