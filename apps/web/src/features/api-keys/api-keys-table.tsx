'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Tag } from '@mlain/ui/components/tag';
import { EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, SlashIcon } from '@/lib/ui/status-icons';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { RotateKeyDialog } from './rotate-key-dialog';
import { RevokeKeyDialog } from './revoke-key-dialog';

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  kind: 'secret' | 'public';
  scopes: string[];
  created_by_name: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  previous_expires_at: string | null;
  created_at: string;
};

export type ApiKeysTableProps = {
  keys: Result<{ data: ApiKeyRow[] }>;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  /**
   * ODCHYLKA OD PLÁNU, vynucená Reactem: plán posílal `onCreate={() => undefined}`
   * ze serverové stránky, jenže obsluhu události nejde předat klientské
   * komponentě propem a stránka spadla na 500 „Event handlers cannot be passed
   * to Client Component props". Prop proto zůstává volitelný a bez něj primární
   * akce prázdného stavu zaostří formulář pod tabulkou, stejně jako u pozvánek.
   */
  onCreate?: (() => void) | undefined;
};

type KeyStatus = 'active' | 'revoked' | 'expired';

export function keyStatus(row: ApiKeyRow, now: Date): KeyStatus {
  if (row.revoked_at !== null) return 'revoked';
  if (row.expires_at !== null && new Date(row.expires_at) <= now) return 'expired';
  return 'active';
}

const STATUS_KEYS = {
  active: 'apiKeys.status.active',
  revoked: 'apiKeys.status.revoked',
  expired: 'apiKeys.status.expired',
} as const satisfies Record<KeyStatus, string>;

const STATUS_TONES = { active: 'success', revoked: 'neutral', expired: 'warning' } as const;

/**
 * `Badge` má ikonu povinnou schválně: stav se nikdy nesděluje jen barvou
 * (pravidlo 11.3 části 6). Barva a slovo samy o sobě nestačí lidem, kteří
 * barvy nerozliší, a text bez ikony se v tabulce ztratí mezi ostatními.
 */
const STATUS_ICONS: Record<KeyStatus, React.ReactNode> = {
  active: CheckIcon,
  revoked: SlashIcon,
  expired: ClockIcon,
};

export function ApiKeysTable(props: ApiKeysTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();
  const [rotating, setRotating] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  // Okamžik se drží ve stavu, aby se při každém překreslení neposunul
  // a relativní čas nezpůsobil rozpor při hydrataci.
  const [now] = useState(() => new Date());

  if (!props.keys.ok) {
    return (
      <SettingsProblem
        problem={props.keys.problem}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  const rows = props.keys.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('apiKeys.title')}
        explanation={t('apiKeys.empty')}
        actions={
          props.canWrite
            ? [
                {
                  label: t('apiKeys.emptyAction'),
                  onClick: props.onCreate ?? (() => document.getElementById('key-name')?.focus()),
                },
              ]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug}`),
                  description: t('apiKeys.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-ui">
          <caption className="sr-only">{t('apiKeys.title')}</caption>
          <thead>
            <tr className="bg-surface-muted">
              {[
                'apiKeys.table.name',
                'apiKeys.table.scopes',
                'apiKeys.table.lastUsedAt',
                'apiKeys.table.status',
                'apiKeys.table.actions',
              ].map((key) => (
                <th
                  key={key}
                  scope="col"
                  // Hlavička se smí zalomit. „Naposledy použit" ve verzálkách
                  // s prostrkáním je širší než hodnoty pod ním, takže by na
                  // jednom řádku roztahovala sloupec o šedesát pixelů, které
                  // pak chybí sloupci s akcemi.
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = keyStatus(row, now);
              const inGracePeriod =
                row.previous_expires_at !== null && new Date(row.previous_expires_at) > now;
              return (
                <tr key={row.id} className="border-b border-border hover:bg-surface-muted">
                  {/* `whitespace-nowrap` je oprava vady, ne kosmetika: tabulka je
                      `w-full` a prohlížeč šířku rozděloval podle obsahu, takže
                      dlouhý výčet oprávnění ukrojil sloupec s názvem na tak
                      úzký, že se „Měřicí kód na web" lámalo na čtyři řádky.
                      Zalamovat se má výčet oprávnění, ne název.

                      TŘÍDA MUSÍ BÝT NA `<p>`, NE JEN NA BUŇCE. `white-space` se
                      sice dědí, ale `packages/ui/src/globals.css` má v základní
                      vrstvě `p { text-wrap: pretty }`, a `text-wrap` je půlka
                      zkratky `white-space`. Zděděné `nowrap` z buňky se tím
                      u každého odstavce uvnitř zase přepne na zalamování.
                      Naměřeno: buňka hlásila `white-space: nowrap` a text se
                      přesto lámal na čtyři řádky. Utilita na `<p>` vyhraje,
                      protože vrstva `utilities` je za vrstvou `base`. */}
                  {/* PŘEDPONA KLÍČE JE V TÉTO BUŇCE, NE VE VLASTNÍM SLOUPCI.
                      Šest sloupců se do hlavního sloupce Nastavení nevešlo:
                      naměřeno 1056 px obsahu na 866 px místa, takže se sloupec
                      s akcemi usekával. Předpona je druhé jméno téhož klíče,
                      ne samostatný údaj, a návrh přesně tohle dělá v seznamech:
                      název, pod ním meta řádek. Žádná informace nezmizela. */}
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <p className="font-semibold whitespace-nowrap text-text">{row.name}</p>
                    <p className="font-mono text-meta whitespace-nowrap text-text-muted">
                      {`ml_live_${row.prefix}_…`}
                    </p>
                    <p className="text-meta whitespace-nowrap text-text-muted">
                      {row.created_by_name}
                    </p>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {/* Oprávnění jsou doplněk k údaji, ne stav, takže `Tag`,
                        ne `Badge`. Zalamují se, protože jich klíč může mít
                        deset a jsou to jediná informace, která se zúžením
                        sloupce nic neztratí. */}
                    <span className="flex flex-wrap gap-1">
                      {row.scopes.map((scope) => (
                        <Tag key={scope}>{scope}</Tag>
                      ))}
                    </span>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] font-mono text-meta whitespace-nowrap text-text-muted">
                    {row.last_used_at === null ? (
                      t('shared.never')
                    ) : (
                      <time dateTime={row.last_used_at} title={row.last_used_at}>
                        {format.relativeTime(new Date(row.last_used_at), now)}
                      </time>
                    )}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <Badge tone={STATUS_TONES[status]} icon={STATUS_ICONS[status]}>
                      {t(STATUS_KEYS[status])}
                    </Badge>
                    {inGracePeriod && row.previous_expires_at !== null ? (
                      <p className="mt-1 text-meta text-warning-text">
                        {t('apiKeys.status.rotating', {
                          time: format.dateTime(new Date(row.previous_expires_at), 'short'),
                        })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] whitespace-nowrap">
                    {props.canWrite && status === 'active' ? (
                      // `size="sm"` (36 px), ne výchozích 44 px: tlačítko
                      // v řádku tabulky je v návrhu nižší než tlačítko
                      // v hlavičce obrazovky.
                      <div className="flex gap-[var(--spacing-inline)]">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setRotating(row)}
                        >
                          {t('apiKeys.rotate.button')}
                        </Button>
                        {/* ODCHYLKA OD PLÁNU: destruktivní varianta `Button` z P05
                          se jmenuje `destructive`, ne `danger`. */}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setRevoking(row)}
                        >
                          {t('apiKeys.revoke.button')}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rotating ? (
        <RotateKeyDialog
          apiKey={rotating}
          workspaceId={props.workspaceId}
          slug={props.slug}
          onClose={() => setRotating(null)}
        />
      ) : null}
      {revoking ? (
        <RevokeKeyDialog
          apiKey={revoking}
          workspaceId={props.workspaceId}
          slug={props.slug}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </>
  );
}
