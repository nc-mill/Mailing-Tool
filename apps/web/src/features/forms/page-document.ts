import {
  blockDefaults,
  DEFAULT_THEME,
  newBlockId,
  type EditorDocument,
} from '@/features/editor/model/document-types';

/**
 * VÝCHOZÍ DOKUMENT VEŘEJNÉ STRÁNKY, předvyplněný dnešním textem povrchu.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíl 2.1. „Nikdo nezačíná na prázdné ploše a nikdo nepřijde o dnešní znění."
 *
 * TEXT SE NEOPISUJE, BERE SE Z PŘEKLADOVÉHO KATALOGU. Nadpis i odstavec sem
 * posílá volající jako hotové věty z `contacts.public.*`, tedy z týchž klíčů,
 * které dnes vykresluje veřejná stránka. Druhá kopie znění v kódu by znamenala,
 * že se předvyplněná stránka časem rozejde s tou vestavěnou a nikdo si toho
 * nevšimne, protože obě vypadají „nějak správně".
 *
 * PATIČKA TU SCHVÁLNĚ NENÍ, na rozdíl od `emptyDocument`. Profil `page` blok
 * patičky zakazuje (`content_footer_forbidden_on_page`), protože odhlašovací
 * odkaz na veřejné stránce vede do prázdna. S patičkou by se nově založená
 * stránka rovnou uložila jako neplatná a čtení by ji obešlo vestavěným textem.
 */
export function pageDocument(input: {
  /** Jméno šablony. Je z něj i `meta.name`, které schéma vyžaduje neprázdné. */
  name: string;
  language: string;
  title: string;
  body: string;
}): EditorDocument {
  return {
    schemaVersion: 1,
    meta: { name: input.name, previewText: '', language: input.language },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: newBlockId(),
        type: 'section',
        props: { ...blockDefaults('section') },
        children: [
          {
            id: newBlockId(),
            type: 'heading',
            props: { ...blockDefaults('heading'), level: 1, content: paragraph(input.title) },
          },
          {
            id: newBlockId(),
            type: 'text',
            props: { ...blockDefaults('text'), content: paragraph(input.body) },
          },
        ],
      },
    ],
  } as EditorDocument;
}

/**
 * Jeden odstavec formátovaného textu. Vlastní převod, ne `plainToRichText`
 * z emitoru: dokument se skládá v prohlížeči, kde uživatel klikl na „Vytvořit
 * stránku", a kvůli dvěma řádkům se do balíku nemá tahat vykreslovací vrstva.
 */
function paragraph(text: string): { t: 'p'; children: { t: 's'; v: string }[] }[] {
  return [{ t: 'p', children: [{ t: 's', v: text }] }];
}
