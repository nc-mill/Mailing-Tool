'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { DnsRecords, type DnsRecord, type DomainChecks } from './dns-records';
import { checkDomainAction } from './actions';

/** Klientský obal obrazovky DNS záznamů: tlačítko Zkontrolovat teď volá server. */
export function DomainScreen({
  workspaceId,
  domainId,
  domain,
  records,
  checks,
  checkedAt,
}: {
  workspaceId: string;
  domainId: string;
  domain: string;
  records: DnsRecord[];
  checks: DomainChecks;
  checkedAt: string | null;
}) {
  const router = useRouter();

  return (
    <DnsRecords
      domain={domain}
      records={records}
      checks={checks}
      checkedAt={checkedAt}
      onCheckNow={async () => {
        await checkDomainAction({ workspaceId, domainId });
        router.refresh();
      }}
    />
  );
}
