'use client';

import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext } from 'react';
import { type FieldCatalog, pickLabel, toCatalogPath } from '../../model/field-catalog';

const CatalogContext = createContext<FieldCatalog | null>(null);
export const FieldCatalogProvider = CatalogContext.Provider;

export function useFieldCatalog(): FieldCatalog {
  return useContext(CatalogContext) ?? { fields: [], version: 'empty' };
}

/** Systémové tagy a pevná pole kontaktu mají popisek v katalogu editoru, vlastní pole v katalogu polí. */
const STATIC_LABELS: Record<string, string> = {
  unsubscribe_url: 'field.unsubscribeUrl',
  preferences_url: 'field.preferencesUrl',
  webview_url: 'field.webviewUrl',
  'campaign.name': 'field.campaignName',
  'campaign.subject': 'field.campaignSubject',
  'workspace.name': 'field.workspaceName',
  'workspace.sender_address': 'field.senderAddress',
  'contact.email': 'field.email',
  'contact.first_name': 'field.firstName',
  'contact.last_name': 'field.lastName',
  'contact.first_name_vocative': 'field.firstNameVocative',
  'contact.last_name_vocative': 'field.lastNameVocative',
  'contact.title_prefix': 'field.titlePrefix',
  'contact.title_suffix': 'field.titleSuffix',
  'contact.greeting': 'field.greeting',
  'contact.gender': 'field.gender',
  'contact.locale': 'field.locale',
  'contact.created_at': 'field.createdAt',
};

export function useFieldLabel(): (expr: string) => string {
  const t = useTranslations('editor');
  const locale = useLocale();
  const catalog = useFieldCatalog();
  return useCallback(
    (expr: string) => {
      const path = (expr.split('|')[0] ?? '').trim();
      const staticKey = STATIC_LABELS[path];
      if (staticKey) return t(staticKey);
      const entry = catalog.fields.find((field) => field.path === toCatalogPath(path));
      return entry ? pickLabel(entry.label, locale) : path;
    },
    [catalog, locale, t],
  );
}
