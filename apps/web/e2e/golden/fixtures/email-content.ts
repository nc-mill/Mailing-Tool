import { expect } from '@playwright/test';
import type { TrappedMessage } from './mailpit';

/**
 * Kontroly OBSAHU doručené zprávy.
 *
 * PROČ TO EXISTUJE. Zlatá cesta dlouho ověřovala jen to, že zpráva dorazila,
 * a z jejího obsahu jedinou větu („Dobrý den"). Tím jí unikly dvě vady, které
 * se našly ručně a obě jsou zákonné, ne kosmetické:
 *
 * 1. `{{ workspace.sender_address }}` v patičce odcházel NENAHRAZENÝ, respektive
 *    prázdný, takže obchodní sdělení odešlo bez poštovní adresy odesílatele.
 * 2. Textová verze potvrzovacího e-mailu adresu neměla vůbec, přestože HTML ji
 *    mělo. Textovou verzi do té doby nekontroloval nikdo.
 *
 * Obě vady jsou v e-mailu vidět na první pohled a přitom prošly celou sadou.
 * Kontroly proto míří na obě těla zprávy, ne jen na HTML.
 */

/**
 * Nenahrazené značky merge tagů.
 *
 * Záměrně hrubý vzor `{{ … }}`: hlídá se, že v odeslaném e-mailu NEZBYLA žádná
 * značka, ne že se nahradila konkrétní. Renderer, který značku nezná, ji nechá
 * projít beze změny, takže se do e-mailu dostane doslova a příjemce si přečte
 * `{{ contact.first_name }}`. Přesně to je stav, který se má hlásit.
 */
export function unreplacedMergeTags(body: string): string[] {
  return [...body.matchAll(/\{\{[^{}]*\}\}/g)].map((match) => match[0]);
}

/** V žádném z obou těl nesmí zbýt nenahrazená značka. */
export function expectNoUnreplacedMergeTags(message: TrappedMessage, label: string): void {
  expect(unreplacedMergeTags(message.html), `${label}: v HTML zůstaly nenahrazené značky`).toEqual(
    [],
  );
  expect(
    unreplacedMergeTags(message.text),
    `${label}: v textové verzi zůstaly nenahrazené značky`,
  ).toEqual([]);
}

/**
 * Textová verze musí existovat a nést smysl.
 *
 * Prázdná `text/plain` část není maličkost: poštovní klienti, které HTML
 * nezajímá, a spamové filtry z ní čtou, a zpráva bez ní si zhoršuje
 * doručitelnost. Kontroluje se proto samostatně, ne jako přívažek k HTML.
 */
export function expectUsableTextPart(message: TrappedMessage, label: string): void {
  expect(message.text.trim(), `${label}: textová verze je prázdná`).not.toBe('');
  expect(
    message.text.replace(/\s+/g, ' ').trim().length,
    `${label}: textová verze je podezřele krátká: ${JSON.stringify(message.text)}`,
  ).toBeGreaterThan(30);
}

/**
 * Poštovní adresa odesílatele v patičce, v OBOU tělech.
 *
 * Porovnává se po znormalizování bílých znaků: v HTML je adresa rozlámaná
 * `<br>` a odsazením šablony, v textu odřádkováním, takže doslovná shoda by
 * hlásila vadu tam, kde žádná není.
 */
export function expectPostalAddress(message: TrappedMessage, address: string, label: string): void {
  const needle = normalize(address);
  expect(normalize(stripTags(message.html)), `${label}: v HTML není poštovní adresa`).toContain(
    needle,
  );
  expect(normalize(message.text), `${label}: v textové verzi není poštovní adresa`).toContain(
    needle,
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Odkaz z TEXTOVÉ verze, kde žádné `href` není.
 *
 * `extractLink` čte `href="…"`, takže na textové tělo nesedí. Potvrzovací
 * e-mail se ale musí dát dokončit i z něj: kdo čte poštu v textu, jinou cestu
 * nemá.
 */
export function extractLinkFromText(text: string, pathFragment: string): string {
  const hit = [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)]
    .map((match) => match[0])
    .find((url) => url.includes(pathFragment));
  if (hit === undefined) {
    throw new Error(`V textové verzi není odkaz obsahující ${pathFragment}.`);
  }
  return hit;
}
