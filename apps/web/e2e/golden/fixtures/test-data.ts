export const ADMIN = {
  name: 'Jana Nováková',
  email: 'jana@firma.cz',
  password: 'ukazkove-heslo-2026',
  locale: 'Čeština',
} as const;

export const PROJECT = {
  name: 'E-shop Kolo',
  emailLocale: 'Čeština',
  timezone: 'Europe/Prague',
  addressForm: 'Vykáním',
} as const;

/** Adresa, kterou test ověří ve zkušebním režimu a na kterou kampaň skutečně odejde. */
export const VERIFIED_RECIPIENT = 'overena@firma.cz';

export const SMTP = {
  host: 'mailpit',
  port: '1025',
  encryption: 'Žádné',
  username: 'test',
  password: 'test',
  fromAddress: 'newsletter@firma.cz',
} as const;

export const CAMPAIGN = {
  name: 'Zlatá cesta: první kampaň',
  subject: 'Vítejte u nás',
  segmentName: 'Aktivní za 90 dní',
  templateName: 'Zlatá cesta: šablona',
} as const;

export const CONTACTS_CSV = 'apps/web/e2e/golden/fixtures/contacts-50.csv';
