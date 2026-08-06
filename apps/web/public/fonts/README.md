# Písmo IBM Plex

Šest souborů `.woff2`, které servíruje aplikace ze svého vlastního serveru.
Deklarace `@font-face` jsou v `apps/web/src/app/globals.css`, rodiny se pak
používají přes tokeny `--font-sans` a `--font-mono` z `@mlain/ui`.

| Soubor                              | Rodina        | Řez | Podmnožina |
| ----------------------------------- | ------------- | --- | ---------- |
| `ibm-plex-sans-400-latin.woff2`     | IBM Plex Sans | 400 | latin      |
| `ibm-plex-sans-400-latin-ext.woff2` | IBM Plex Sans | 400 | latin-ext  |
| `ibm-plex-sans-600-latin.woff2`     | IBM Plex Sans | 600 | latin      |
| `ibm-plex-sans-600-latin-ext.woff2` | IBM Plex Sans | 600 | latin-ext  |
| `ibm-plex-mono-400-latin.woff2`     | IBM Plex Mono | 400 | latin      |
| `ibm-plex-mono-400-latin-ext.woff2` | IBM Plex Mono | 400 | latin-ext  |

## Proč je každý řez dvakrát

`latin` nese anglickou abecedu, `latin-ext` nese ě, š, č, ř, ž, ů, ď, ť, ň
a dlouhé samohlásky. **Bez `latin-ext` se čeština rozsype**: prohlížeč by
znaky s háčky a čárkami vykreslil náhradním systémovým písmem a slovo by
v půlce změnilo tvar. Rozdělení není nadbytečné, prohlížeč si podle
`unicode-range` stáhne jen tu podmnožinu, kterou stránka opravdu potřebuje.

## Proč ne `next/font`

`next/font` umí stáhnout Google font při sestavení, ale podmnožinu si volí
sám podle `subsets`. Tady je potřeba mít obě podmnožiny a jejich `unicode-range`
pod kontrolou v CSS, protože se stejné tokeny používají i mimo Next
(`packages/ui` je samostatný balíček) a protože chceme, aby bylo v jednom
souboru vidět, co se z jaké podmnožiny načítá. Sestavení navíc neběží
u zákazníka, kde nemusí být přístup ven.

## Odkud soubory jsou

Z Google Fonts, verze IBM Plex Sans a IBM Plex Mono z 5. 8. 2026.

Písmo IBM Plex vydává IBM pod **SIL Open Font License 1.1**, která dovoluje
samohostování i redistribuci. Zdroj a plné znění licence:
<https://github.com/IBM/plex>.

## Jak je vyměnit

Když bude potřeba jiný řez, stáhne se stejným způsobem: z
`https://fonts.googleapis.com/css2?family=…` se vezmou bloky s komentářem
`/* latin */` a `/* latin-ext */`, z nich URL na `.woff2` a `unicode-range`,
a obojí se přenese sem a do `globals.css`. Řez 700 se záměrně nenačítá,
návrh používá jen 400 a 600.
