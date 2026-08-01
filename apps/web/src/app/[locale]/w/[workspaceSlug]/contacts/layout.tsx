import type { ReactNode } from 'react';
import { ContactsToasts } from '@/features/contacts/contacts-toasts';

/**
 * `useToast` (K5) vyžaduje `ToastProvider` v kontextu a skořápka projektu ho zatím
 * nemontuje. Obrazovky domény kontaktů si ho proto zapínají samy.
 */
export default function ContactsSectionLayout({ children }: { children: ReactNode }) {
  return <ContactsToasts>{children}</ContactsToasts>;
}
