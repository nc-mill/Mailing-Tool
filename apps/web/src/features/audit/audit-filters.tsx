'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { AUDIT_ACTION_KEYS } from './audit-actions';

export type AuditFiltersProps = {
  basePath: string;
  filters: Record<string, string>;
};

/**
 * Filtry jsou v query parametrech, ne ve stavu komponenty, aby šel odkaz na
 * filtrovaný výsledek poslat kolegovi (pravidlo z 4.3 části 6).
 */
export function AuditFilters({ basePath, filters }: AuditFiltersProps) {
  const t = useTranslations('settings');

  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
      <div>
        <SelectField
          name="action"
          label={t('audit.filters.action')}
          placeholder={t('audit.filters.allActions')}
          defaultValue={filters['action'] ?? ''}
          options={Object.entries(AUDIT_ACTION_KEYS).map(([action, key]) => ({
            value: action,
            label: t(key as 'audit.actions.user.login'),
          }))}
        />
      </div>

      <div>
        <Label htmlFor="audit-from">{t('audit.filters.from')}</Label>
        <Input id="audit-from" name="from" type="date" defaultValue={filters['from'] ?? ''} />
      </div>

      <div>
        <Label htmlFor="audit-to">{t('audit.filters.to')}</Label>
        <Input id="audit-to" name="to" type="date" defaultValue={filters['to'] ?? ''} />
      </div>

      <Button type="submit" variant="secondary">
        {t('audit.filters.apply')}
      </Button>
    </form>
  );
}
