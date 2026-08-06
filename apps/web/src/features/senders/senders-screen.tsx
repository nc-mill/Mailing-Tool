'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
// Odkazy i router jdou přes `@mlain/i18n/navigation`, ne přímo z Nextu:
// obálka drží prefix jazyka v adrese. Přímý `next/link` by z projektu odvedl
// na cestu bez locale a middleware by na ni musel přesměrovávat.
import { Link, useRouter } from '@mlain/i18n/navigation';
// Ikony jdou přes vlastní obal, ne přímo z `lucide-react`: apps/web ten balíček
// v závislostech nemá, vlastní ho `packages/ui`.
import { CheckIcon, ClockIcon } from '@/lib/ui/status-icons';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { SettingsPageShell, SettingsStack } from '@/features/settings/settings-page-shell';
import {
  createSenderAction,
  deleteSenderAction,
  setDefaultSenderAction,
  updateSenderAction,
  type SenderIdentityBody,
} from './actions';
import { SenderDialog, type SenderDomainOption } from './sender-dialog';

/** Tvar z `GET /api/v1/senders`. */
export type SenderIdentityView = {
  id: string;
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  provider_name: string;
  provider_status: string;
  sender_domain_id: string;
  domain: string;
  domain_verified: boolean;
  is_default: boolean;
};

/**
 * Obrazovka správy předvolených odesílatelů.
 *
 * Je to seznam, ne formulář, a je to podstatné: uživatel s víc doménami a víc
 * účty jich má několik a potřebuje na první pohled vidět, která je výchozí
 * a která stojí na doméně, ze které se zatím neodešle. Vlastnosti jedné
 * předvolby se proto řeší v dialogu, ne na stránce.
 */
export function SendersScreen({
  identities,
  domains,
  workspaceId,
  basePath,
  canEdit,
}: {
  identities: SenderIdentityView[];
  domains: SenderDomainOption[];
  workspaceId: string;
  basePath: string;
  /**
   * Předvolby jsou nastavení odesílání, takže je mění jen ten, kdo smí měnit
   * odesílací účty (`providers:write`, tedy správce). Čtenář a editor je vidí,
   * což stačí: v kampani si z nich vybírá každý.
   */
  canEdit: boolean;
}) {
  const t = useTranslations('campaigns.senders');
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<SenderIdentityView | null>(null);
  const [removed, setRemoved] = useState<SenderIdentityView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * `revalidatePath` v serverové akci sám seznam nepřekreslí, protože akci
   * voláme imperativně, ne přes `<form action>`. Musí následovat `refresh`.
   * Týž vzor jako v `sending-screen.tsx`.
   */
  function refresh() {
    router.refresh();
  }

  async function save(body: SenderIdentityBody) {
    const result =
      edited === null
        ? await createSenderAction({ workspaceId, body })
        : await updateSenderAction({ workspaceId, id: edited.id, body });
    if (result.status === 'success') refresh();
    return result;
  }

  async function makeDefault(identity: SenderIdentityView) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await setDefaultSenderAction({ workspaceId, id: identity.id });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (removed === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await deleteSenderAction({ workspaceId, id: removed.id });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      setRemoved(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEdited(null);
    setDialogOpen(true);
  }

  function openEdit(identity: SenderIdentityView) {
    setEdited(identity);
    setDialogOpen(true);
  }

  return (
    // Hlavička jde přes `SettingsPageShell`, ne přes vlastní `<h1>`. Do 5. 8. 2026
    // si ji tahle obrazovka kreslila sama v `text-xl` (20 px z výchozí škály
    // Tailwindu), takže měla v levém menu Nastavení jiný název než sousední
    // sekce, které mají 36 px z `--text-h1`.
    <SettingsPageShell
      title={t('title')}
      lead={t('subtitle')}
      {...(canEdit && identities.length > 0
        ? {
            action: (
              <Button variant="primary" data-testid="add-sender" onClick={openCreate}>
                {t('add')}
              </Button>
            ),
          }
        : {})}
    >
      <SettingsStack>
        {failure !== null && (
          <Alert tone="error" data-testid="senders-error">
            {failure}
          </Alert>
        )}

        {/* Bez domény není z čeho předvolbu složit. Místo prázdného formuláře se
            ukáže cesta tam, kde doména vzniká. */}
        {domains.length === 0 ? (
          <Alert tone="warning" title={t('noDomainsTitle')} data-testid="senders-no-domains">
            {t('noDomainsExplanation')}{' '}
            <Link href={`${basePath}/settings/sending`} className="underline">
              {t('noDomainsAction')}
            </Link>
          </Alert>
        ) : identities.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('emptyTitle')}
            explanation={t('emptyExplanation')}
            actions={[{ label: t('add'), onClick: openCreate }]}
          />
        ) : (
          <ul className="flex flex-col gap-[var(--spacing-gutter)]" data-testid="sender-list">
            {identities.map((identity) => (
              // Předvolba je karta: papír, hairline rámeček, okraj 25 px.
              // Rytmus vnořené karty z detailu seznamu. `Card` umí `section`,
              // `div`, `article` a `aside`, ne `li`, takže položku seznamu drží
              // obal a karta je uvnitř.
              <li key={identity.id} data-testid={`sender-${identity.id}`}>
                <Card as="div" padding="md">
                  <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                    <span className="text-body font-semibold text-text">{identity.name}</span>
                    {identity.is_default && (
                      <Badge tone="accent" icon={CheckIcon}>
                        {t('defaultBadge')}
                      </Badge>
                    )}
                    {/* Obal nese testovací značku: `Badge` cizí atributy nepředává. */}
                    <span data-testid={`sender-domain-state-${identity.id}`}>
                      <Badge
                        tone={identity.domain_verified ? 'success' : 'warning'}
                        icon={identity.domain_verified ? CheckIcon : ClockIcon}
                      >
                        {identity.domain_verified
                          ? t('domainVerified', { domain: identity.domain })
                          : t('domainPending', { domain: identity.domain })}
                      </Badge>
                    </span>
                  </div>

                  {/* Adresa se čte po znacích, takže mono. */}
                  <p className="font-mono text-meta text-text">
                    {identity.from_name} &lt;{identity.from_email}&gt;
                  </p>
                  <p className="text-meta text-text-muted">
                    {identity.reply_to === null
                      ? t('replyToSame')
                      : t('replyToValue', { email: identity.reply_to })}
                    {' · '}
                    {t('viaProvider', { name: identity.provider_name })}
                  </p>

                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid={`edit-sender-${identity.id}`}
                        onClick={() => openEdit(identity)}
                      >
                        {t('edit')}
                      </Button>
                      {!identity.is_default && (
                        <Button
                          variant="ghost"
                          size="sm"
                          pending={busy}
                          pendingLabel={t('working')}
                          data-testid={`default-sender-${identity.id}`}
                          onClick={() => void makeDefault(identity)}
                        >
                          {t('makeDefault')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`delete-sender-${identity.id}`}
                        onClick={() => setRemoved(identity)}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </SettingsStack>

      <SenderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        identity={edited}
        domains={domains}
        onSubmit={save}
      />

      <Dialog open={removed !== null} onOpenChange={(open) => !open && setRemoved(null)}>
        <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
        <DialogBody>
          <p className="text-text-muted">
            {t('deleteDialog.explanation', { name: removed?.name ?? '' })}
          </p>
          {/* Věta, na kterou se uživatel ptá jako první: co to udělá s kampaněmi. */}
          <p className="text-text-muted">{t('deleteDialog.campaignsSafe')}</p>
        </DialogBody>
        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setRemoved(null)}>
              {t('deleteDialog.cancel')}
            </Button>
          }
          confirm={
            <Button
              variant="destructive"
              data-testid="confirm-delete-sender"
              pending={busy}
              pendingLabel={t('deleteDialog.deleting')}
              onClick={() => void confirmRemove()}
            >
              {t('deleteDialog.confirm')}
            </Button>
          }
        />
      </Dialog>
    </SettingsPageShell>
  );
}
