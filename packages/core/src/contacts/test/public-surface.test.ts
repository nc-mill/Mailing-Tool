import { describe, expect, it } from 'vitest';
import * as surface from '../index';

/**
 * ODCHYLKA OD PLÁNU, VĚDOMÁ A ZAPSANÁ.
 *
 * Plán má v úkolu 1 jeden seznam pro celou doménu, tedy včetně jmen, která vznikají
 * až v úkolech 14 až 70 (upsertContacts, getFieldCatalog, isMailable, checkSuppression,
 * addSuppression, issueUnsubscribeToken, severContactLinks, listReviewGroups). Ta jména
 * dnes nemají co reexportovat a barrel by se nepřeložil.
 *
 * Test proto hlídá plochu, která už existuje, a druhý seznam drží jména, která do ní
 * musí přibýt spolu se svým úkolem. Nezmizí tím ani jedno: seznam OČEKÁVANÁ je psaný
 * seznam závazků vůči cizím plánům a je vidět na jednom místě.
 */
const DODANO_FAZI_A = [
  'resolveName', // P11 náhled importu
  'normalizeNameKey', // P11 seskupení fronty, P07 name_overrides
  'normalizeEmail', // každý kanál zápisu
  'maskEmail', // veřejné stránky a seznam blokovaných adres
  'computeAllFingerprints', // P13 kontrola před odesláním
  'computeCurrentFingerprint', // zápis suppression řádku
  'computeAllFingerprintsBatch',
  'CONTACTS_ERROR_CODES',
  'CONTACTS_AUDIT_ACTIONS',
  'CONTACTS_QUEUES',
];

/** Přibylo fází B, tedy úkoly 14 až 25. */
const DODANO_FAZI_B = [
  'upsertContacts', // úkol 14, P11 import
  'writeContact', // úkol 15, veřejné formuláře a příchozí webhooky
  'evaluateMailability', // úkol 18, P13 materializace publika
  'isMailable', // úkol 18, zkratka nad toutéž bránou
  'MAILABLE_STATUS', // úkol 18, jediný mailovatelný stav
  'getFieldCatalog', // úkol 21, P08 renderer a P12 editor
];

/** Přibylo fází C, tedy úkoly 26 až 43. */
const DODANO_FAZI_C = [
  'checkSuppression', // úkol 34, P13 před odesláním
  'addSuppression', // úkol 35, P13 odrazy a stížnosti
  'issueUnsubscribeToken', // úkol 30, P13 skládání zprávy
  'severContactLinks', // úkol 41, P10 po výmazu
  'registerRevokePendingMessages', // úkol 31, P13 registruje svou implementaci
];

const OCEKAVANA_V_DALSICH_UKOLECH = [
  'listReviewGroups', // P11 odkaz z výsledku importu
];

describe('veřejná plocha domény', () => {
  it('vystavuje jména, na která spoléhají cizí plány', () => {
    for (const name of [...DODANO_FAZI_A, ...DODANO_FAZI_B, ...DODANO_FAZI_C]) {
      expect(surface, `chybí export ${name}`).toHaveProperty(name);
    }
  });

  it('má zapsané, co do plochy ještě musí přibýt', () => {
    // Seznam sám je kontrakt. Kdyby se vyprázdnil dřív, než jména vzniknou,
    // ztratil by se závazek vůči P08, P11, P12 a P13.
    expect(OCEKAVANA_V_DALSICH_UKOLECH.length).toBeGreaterThan(0);
  });

  it('nevystavuje vnitřek domény', () => {
    // Barrel, do kterého se dá dát cokoliv, přestane být kontraktem. Uzávěr S11.
    for (const name of [
      'applyWriteRules',
      'rankCaseSql',
      'readPath',
      'GIVEN_NAMES',
      'lookupGivenName',
      'splitFullName',
      'extractTitles',
      'callLibrary',
    ]) {
      expect(surface, `${name} do veřejné plochy nepatří`).not.toHaveProperty(name);
    }
  });
});
