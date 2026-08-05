'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { DnsRecords, type DnsRecord, type DomainChecks } from './dns-records';
import { DeleteDomainDialog } from './delete-domain-dialog';
import { checkDomainAction, deleteDomainAction } from './actions';

/**
 * Klientský obal obrazovky DNS záznamů: tlačítko Zkontrolovat teď volá server.
 *
 * Odebrání domény je i tady, ne jen v seznamu. Uživatel, který zjistí, že doménu
 * přidal omylem, je právě na téhle obrazovce a nutit ho zpátky do seznamu jen
 * kvůli tlačítku by byla zbytečná cesta.
 */
export function DomainScreen({
  workspaceId,
  domainId,
  domain,
  records,
  checks,
  checkedAt,
  sesStatus,
  verifiedAt,
  basePath,
}: {
  workspaceId: string;
  domainId: string;
  domain: string;
  records: DnsRecord[];
  checks: DomainChecks;
  checkedAt: string | null;
  sesStatus: string | null;
  verifiedAt: string | null;
  basePath: string;
}) {
  const router = useRouter();
  const t = useTranslations('campaigns.sending.deleteDomainDialog');
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <DnsRecords
        domain={domain}
        records={records}
        checks={checks}
        checkedAt={checkedAt}
        sesStatus={sesStatus}
        verifiedAt={verifiedAt}
        onCheckNow={async () => {
          await checkDomainAction({ workspaceId, domainId });
          router.refresh();
        }}
      />

      <div className="mt-8">
        <Button variant="ghost" data-testid="delete-domain" onClick={() => setDeleting(true)}>
          {t('open')}
        </Button>
      </div>

      {deleting && (
        <DeleteDomainDialog
          domain={{ id: domainId, domain }}
          open
          onOpenChange={setDeleting}
          onConfirm={async () => {
            const result = await deleteDomainAction({ workspaceId, domainId });
            if (result.status === 'success') {
              // Detail odebrané domény by po obnově skončil na 404, takže se jde
              // rovnou na seznam. `refresh` je tam nutný i po `push`: bez něj by
              // se seznam vzal z klientské cache i s doménou, která už není.
              router.push(`${basePath}/settings/sending`);
              router.refresh();
            }
            return result;
          }}
        />
      )}
    </>
  );
}
