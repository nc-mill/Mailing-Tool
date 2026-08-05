import { plainToRichText } from '@mlain/emails/base';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document, SectionBlock, SectionChild } from '@mlain/emails/document/types';

/**
 * Obecné znění tří e-mailů seznamu: potvrzení, uvítání, rozloučení.
 *
 * KONSTANTA V KÓDU, NE SEEDOVANÝ ŘÁDEK U KAŽDÉHO PROJEKTU. Je to návrh z plánu
 * `docs/superpowers/plans/2026-08-05-emaily-seznamu.md`, kapitola 3, ne odpověď
 * zadavatele na některou ze šesti otázek. Kdyby se výchozí znění zakládalo jako šablona při vzniku projektu,
 * vznikla by jeho kopie u každého zákazníka a oprava překlepu by znamenala datovou
 * migraci přes všechny projekty. Takhle se zlepší nasazením a `NULL` ve sloupci
 * `lists.confirmation_template_id` znamená prostě „použije se tohle".
 *
 * VLASTNÍ ZNĚNÍ SE ZAKLÁDÁ JAKO ŠABLONA, předvyplněná právě tímhle dokumentem.
 * Odsud si ho bere obrazovka seznamu (tlačítko „Vytvořit vlastní e-mail"), takže
 * uživatel začíná na tom, co by mu jinak odešlo, a ne na prázdné stránce.
 *
 * PATIČKA NENESE ODHLAŠOVACÍ ODKAZ, a není to opomenutí. Zprávy seznamu odcházejí
 * s `messages.kind = 'transactional'` a sender u toho druhu odhlašovací odkaz
 * NEVYRÁBÍ: `worker.go` mu do render dat dosadí prázdný řetězec
 * (`data["unsubscribe_url"] = unsub`, kde `unsub` je u transakční zprávy `""`).
 * Patička se zapnutým odhlášením by tedy vyrobila odkaz do prázdna. Stejný důvod
 * platí pro centrum předvoleb i pro zobrazení v prohlížeči, ty sender transakční
 * zprávě záměrně nedodává vůbec.
 *
 * Poštovní adresa odesílatele v patičce ZŮSTÁVÁ. Je to údaj, který má být
 * v obchodním sdělení vidět, a bere se z dat zprávy, ne ze zapečeného textu.
 */

export type SubscriptionEmailKind = 'confirmation' | 'welcome' | 'goodbye';

/** Jazyk výchozího znění. Jiné jazyky spadnou na angličtinu. */
export type SubscriptionEmailLanguage = 'cs' | 'en';

/**
 * Cesta, pod kterou se do šablony dostane potvrzovací odkaz.
 *
 * Kořen `data` je v Liquidu povolený jen pro `kind = 'transactional'`
 * (`packages/contracts/src/liquid/grammar.ts`), což je přesně druh, kterým
 * e-maily seznamu odcházejí. Žádný nový kořen a žádný zásah do Go senderu.
 */
export const CONFIRM_URL_PATH = 'data.confirm_url';

/** Výraz tak, jak ho autor napíše do odkazu nebo tlačítka. */
export const CONFIRM_URL_EXPRESSION = `{{ ${CONFIRM_URL_PATH} }}`;

/** Identifikátor bloku podle 3.1.3: `b_` a dvanáct znaků [0-9a-z]. */
const blockId = (prefix: string, ordinal: number): string =>
  `b_${prefix}${String(ordinal).padStart(12 - prefix.length, '0')}`;

type Copy = {
  /** Jméno dokumentu. Je z něj i předmět, `subjectFor` bere `meta.name`. */
  name: string;
  previewText: string;
  headline: string;
  body: string;
  /** Jen u potvrzení: popisek tlačítka a věta nad holou adresou. */
  cta?: string;
  fallback?: string;
};

const COPY: Record<SubscriptionEmailLanguage, Record<SubscriptionEmailKind, Copy>> = {
  cs: {
    confirmation: {
      name: 'Potvrďte prosím přihlášení k odběru',
      previewText: 'Zbývá jediné kliknutí',
      headline: 'Potvrďte přihlášení k odběru',
      body: 'Dobrý den, někdo (nejspíš vy) přihlásil tuhle adresu k odběru. Potvrďte to prosím kliknutím na tlačítko níž. Dokud to neuděláte, nic vám posílat nebudeme.',
      cta: 'Potvrdit přihlášení',
      fallback:
        'Kdyby tlačítko nefungovalo, otevřete tuhle adresu:\n\n{{ data.confirm_url }}\n\nJestli jste o odběr nežádali, nedělejte nic. Bez potvrzení se nic nestane.',
    },
    welcome: {
      name: 'Vítejte v odběru',
      previewText: 'Přihlášení je potvrzené',
      headline: 'Vítejte',
      body: 'Přihlášení je potvrzené, děkujeme. Od téhle chvíle vám budou chodit naše e-maily. Odhlásit se můžete kdykoli odkazem v patičce každého z nich.',
    },
    goodbye: {
      name: 'Odhlášení je hotové',
      previewText: 'Už vám nic posílat nebudeme',
      headline: 'Odhlášení je hotové',
      body: 'Tuhle adresu jsme z odběru odhlásili, žádné další e-maily už vám neodejdou. Kdyby se to stalo omylem, stačí se přihlásit znovu.',
    },
  },
  en: {
    confirmation: {
      name: 'Please confirm your subscription',
      previewText: 'One click left',
      headline: 'Confirm your subscription',
      body: 'Hello, someone (most likely you) subscribed this address. Please confirm it with the button below. Until you do, we will not send you anything.',
      cta: 'Confirm subscription',
      fallback:
        'If the button does not work, open this address:\n\n{{ data.confirm_url }}\n\nIf you did not ask for the subscription, do nothing. Without confirmation nothing happens.',
    },
    welcome: {
      name: 'Welcome aboard',
      previewText: 'Your subscription is confirmed',
      headline: 'Welcome',
      body: 'Your subscription is confirmed, thank you. From now on our emails will reach you. You can unsubscribe any time with the link in the footer of each of them.',
    },
    goodbye: {
      name: 'You are unsubscribed',
      previewText: 'We will not send you anything else',
      headline: 'You are unsubscribed',
      body: 'We removed this address from the subscription, no further emails will be sent. If it happened by mistake, just subscribe again.',
    },
  },
};

const PREFIX: Record<SubscriptionEmailKind, string> = {
  confirmation: 'conf',
  welcome: 'welc',
  goodbye: 'good',
};

/** Jazyk dokumentu z libovolného kódu jazyka. Neznámý padá na angličtinu. */
export function subscriptionEmailLanguage(locale: string | null): SubscriptionEmailLanguage {
  return (locale ?? '').toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

/**
 * Výchozí dokument jednoho druhu e-mailu.
 *
 * Vrací VŽDY NOVOU KOPII. Volající s dokumentem dál pracuje (zakládá z něj
 * šablonu, mění jméno) a sdílená reference by tichou změnou přepsala výchozí
 * znění pro celý proces.
 */
export function defaultSubscriptionEmail(
  kind: SubscriptionEmailKind,
  language: SubscriptionEmailLanguage,
): Document {
  const copy = COPY[language][kind];
  const prefix = PREFIX[kind];
  const children: SectionChild[] = [
    {
      id: blockId(prefix, 1),
      type: 'heading',
      props: { ...blockDefaults('heading'), level: 1, content: plainToRichText(copy.headline) },
    },
    {
      id: blockId(prefix, 2),
      type: 'text',
      props: { ...blockDefaults('text'), content: plainToRichText(copy.body) },
    },
  ];

  if (copy.cta !== undefined) {
    children.push({
      id: blockId(prefix, 3),
      type: 'button',
      props: {
        ...blockDefaults('button'),
        label: plainToRichText(copy.cta),
        href: CONFIRM_URL_EXPRESSION,
      },
    });
  }

  if (copy.fallback !== undefined) {
    // Holá adresa jako TEXT, ne jako druhý odkaz. Část poštovních klientů tlačítko
    // nevykreslí a bez vypsané adresy se z takového e-mailu nedá potvrdit vůbec.
    children.push({
      id: blockId(prefix, 4),
      type: 'text',
      props: { ...blockDefaults('text'), content: plainToRichText(copy.fallback) },
    });
  }

  children.push({
    id: blockId(prefix, 8),
    type: 'footer',
    // Viz hlavička souboru: transakční zpráva odhlašovací odkaz, předvolby ani
    // zobrazení v prohlížeči od senderu nedostane, takže se v patičce nezapínají.
    props: {
      ...blockDefaults('footer'),
      showUnsubscribe: false,
      showPreferences: false,
      showWebview: false,
    },
  });

  const section: SectionBlock = {
    id: blockId(prefix, 9),
    type: 'section',
    props: blockDefaults('section'),
    children,
  };

  return {
    schemaVersion: 1,
    meta: { name: copy.name, previewText: copy.previewText, language },
    theme: structuredClone(DEFAULT_THEME),
    blocks: [section],
  };
}
